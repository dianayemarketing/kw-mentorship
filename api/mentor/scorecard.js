// Intended repo path: api/mentor/scorecard.js
// Read-only, password-gated. Returns every active mentee's CURRENT-week
// scorecard rollup. Reuses the same METRICS/target logic as
// api/daily-activity/[token].js so the mentor view and the mentee view can
// never disagree about what "on track" means — this file does not
// reimplement the math, it mirrors it.
//
// OPEN ITEM, not resolved here: the Level 1 Launch spec lists New RE
// Conversations at a target of 18/week; the value below (35) is what's
// actually shipped in api/daily-activity/[token].js. Left as-is until that
// conflict is resolved — this file intentionally matches what's LIVE, not
// the spec.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TZ = 'America/Los_Angeles';

function pacificDateString(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// KEEP IN SYNC with METRICS in api/daily-activity/[token].js and mentee.html.
const METRICS = [
  { key: 'leadgen_hours',           label: 'Lead-Generation Hours',   weight: 0.20, ramp: [6, 8, 10, 12], flat: 12 },
  { key: 'new_conversations',       label: 'New RE Conversations',    weight: 0.15, ramp: [20, 30, 35, 35], flat: 35 },
  { key: 'followup_conversations',  label: 'Follow-Up Conversations', weight: 0.15, ramp: [6, 8, 10, 12], flat: 12 },
  { key: 'business_building_days',  label: 'Business-Building Days',  weight: 0.10, ramp: [3, 4, 5, 6], flat: 6, derived: true },
  { key: 'roleplay_sessions',       label: 'Role-Play Sessions',      weight: 0.10, ramp: [1, 2, 3, 3], flat: 3 },
  { key: 'database_contacts',       label: 'Database Contacts',       weight: 0.10, ramp: [0, 5, 5, 5], flat: 5 },
  { key: 'open_houses',             label: 'Open Houses',             weight: 0.10, ramp: [0, 0, 0, 1], flat: 1 },
  { key: 'social_posts',            label: 'Social Posts / Videos',   weight: 0.05, ramp: [1, 2, 3, 3], flat: 3 },
  { key: 'crm_updated_days',        label: 'CRM-Updated Days',        weight: 0.05, ramp: [0, 3, 5, 6], flat: 6, derived: true }
];

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const dow = d.getUTCDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (x) => x.toISOString().slice(0, 10);
  return [fmt(monday), fmt(sunday)];
}

function programWeekForRange(onboardDate, weekStartStr) {
  if (!onboardDate) return 1;
  const start = new Date(onboardDate + 'T00:00:00Z');
  const ws = new Date(weekStartStr + 'T00:00:00Z');
  const days = Math.floor((ws - start) / 86400000);
  const wk = Math.floor(days / 7) + 1;
  return Math.min(Math.max(wk, 1), 10);
}

function targetFor(metric, week) {
  if (week <= 4) return metric.ramp[week - 1];
  return metric.flat;
}

function trafficFor(pct) {
  if (pct >= 85) return 'green';
  if (pct >= 60) return 'amber';
  return 'red';
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers['x-mentor-password'];
  if (auth !== process.env.MENTOR_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: mentees, error: mErr } = await supabase
      .from('mentees')
      .select('id, name, onboard_date')
      .eq('is_active', true)
      .order('name');
    if (mErr) throw mErr;

    const todayStr = pacificDateString();
    const [weekStart, weekEnd] = mondayOf(todayStr);

    const results = await Promise.all(mentees.map(async (m) => {
      const week = programWeekForRange(m.onboard_date, weekStart);

      const { data: entries } = await supabase
        .from('daily_activity')
        .select('*')
        .eq('mentee_id', m.id)
        .gte('entry_date', weekStart)
        .lte('entry_date', weekEnd);

      const totals = {};
      (entries || []).forEach(e => {
        METRICS.forEach(mt => {
          if (mt.derived) return;
          totals[mt.key] = (totals[mt.key] || 0) + (Number(e[mt.key]) || 0);
        });
      });
      // Derived metrics — same rules as api/daily-activity/[token].js POST validation implies.
      totals.business_building_days = (entries || []).filter(e =>
        (Number(e.leadgen_hours) || 0) >= 1 &&
        ((Number(e.new_conversations) || 0) + (Number(e.followup_conversations) || 0)) >= 3
      ).length;
      totals.crm_updated_days = (entries || []).filter(e => (Number(e.database_contacts) || 0) > 0).length;

      let weightedSum = 0;
      const metricStatus = {};
      METRICS.forEach(mt => {
        const target = targetFor(mt, week);
        const actual = totals[mt.key] || 0;
        const pct = target > 0 ? Math.min(actual / target, 1) : 1;
        weightedSum += pct * mt.weight;
        metricStatus[mt.key] = trafficFor(pct * 100);
      });

      const overall = Math.round(weightedSum * 100);

      return {
        mentee_id: m.id,
        name: m.name,
        program_week: week,
        metrics: metricStatus,
        overall_pct: overall,
        overall_status: overall >= 85 ? 'ON TRACK' : overall >= 60 ? 'NEEDS ATTENTION' : 'OFF TRACK'
      };
    }));

    return res.status(200).json({ week_start: weekStart, week_end: weekEnd, mentees: results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
