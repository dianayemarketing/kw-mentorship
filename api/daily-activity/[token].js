// Intended repo path: api/daily-activity/[token].js
// New endpoint for the Weekly Accountability Scorecard.
// Does not touch checklist_progress or the /api/progress/[token] path.
//
// TIMEZONE: hardcoded to America/Los_Angeles. Program is strictly South
// Bay agents, so the server is the sole source of truth for "today" and
// the editable-window check — no client-supplied date is trusted.
//
// HISTORY (added): GET now accepts an optional ?week_start=YYYY-MM-DD to
// view a past week read-only. Targets/rollups are computed live from
// daily_activity each time (live-compute, not snapshotted) — safe because
// past weeks are already frozen by the editable-window rule below, so the
// underlying rows never change once a week has closed. POST is completely
// unaffected: it always validates against the CURRENT week regardless of
// what week_start a GET request asked to view, so viewing history can
// never accidentally open a write path into a past week.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TZ = 'America/Los_Angeles';

// History can't go back further than this date, regardless of onboard_date.
// Weeks before this have no real daily_activity rows (the table didn't
// exist yet), so scrolling there would render a false 0%/OFF TRACK
// scorecard for mentees who onboarded earlier — not real underperformance.
// Update to the actual deploy date before shipping.
const FEATURE_LAUNCH_DATE = '2026-09-11';

function pacificDateString(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// 9 scorecard metrics -> weight + ramped targets (Wk1-4) + flat target (Wk5-10)
// Business-Building Day and CRM-Updated Day are DERIVED, not stored directly.
// KEEP IN SYNC with the copy of this table in mentee.html and scorecard.js.
//
// cadence: 'daily'  — has an explicit per-day rate in the Level 1 Operating
//          Standard (e.g. "2 hrs/day x 6 days"); batching it at week's end
//          defeats the habit it's meant to build, so the mentee UI prompts
//          for it on the day it happened.
//          'weekly' — only a weekly total exists in the standard, no daily
//          breakdown; fine to log anytime before Sunday. Storage is still
//          per entry_date either way — cadence only changes how the mentee
//          UI frames/groups the field, not how POST validates or stores it.
export const METRICS = [
  { key: 'leadgen_hours',           label: 'Lead-Generation Hours',   weight: 0.20, ramp: [6, 8, 10, 12], flat: 12, cadence: 'daily' },
  { key: 'new_conversations',       label: 'New RE Conversations',    weight: 0.15, ramp: [20, 30, 35, 35], flat: 35, cadence: 'daily' },
  { key: 'followup_conversations',  label: 'Follow-Up Conversations', weight: 0.15, ramp: [6, 8, 10, 12], flat: 12, cadence: 'daily' },
  { key: 'business_building_days',  label: 'Business-Building Days',  weight: 0.10, ramp: [3, 4, 5, 6], flat: 6, derived: true, cadence: 'daily' },
  { key: 'roleplay_sessions',       label: 'Role-Play Sessions',      weight: 0.10, ramp: [1, 2, 3, 3], flat: 3, cadence: 'weekly' },
  { key: 'database_contacts',       label: 'Database Contacts',       weight: 0.10, ramp: [0, 5, 5, 5], flat: 5, cadence: 'weekly' },
  { key: 'open_houses',             label: 'Open Houses',             weight: 0.10, ramp: [0, 0, 0, 1], flat: 1, cadence: 'weekly' },
  { key: 'social_posts',            label: 'Social Posts / Videos',   weight: 0.05, ramp: [1, 2, 3, 3], flat: 3, cadence: 'weekly' },
  { key: 'crm_updated_days',        label: 'CRM-Updated Days',        weight: 0.05, ramp: [0, 3, 5, 6], flat: 6, derived: true, cadence: 'daily' }
];

function mondayOf(dateStr) {
  // dateStr: YYYY-MM-DD. Returns [weekStart, weekEnd] as YYYY-MM-DD, Mon-Sun.
  const d = new Date(dateStr + 'T12:00:00Z'); // noon UTC avoids DST edge issues
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (x) => x.toISOString().slice(0, 10);
  return [fmt(monday), fmt(sunday)];
}

// Original: program week relative to "today". Still used nowhere directly
// now that GET always goes through programWeekForRange below, but kept
// for compatibility in case anything else imports it.
function programWeek(onboardDate) {
  if (!onboardDate) return 1;
  const start = new Date(onboardDate + 'T00:00:00Z');
  const today = new Date(pacificDateString() + 'T00:00:00Z');
  const days = Math.floor((today - start) / 86400000);
  const wk = Math.floor(days / 7) + 1;
  return Math.min(Math.max(wk, 1), 10);
}

// Program week relative to an arbitrary week's Monday — used so a past
// week's targets reflect the ramp that applied THAT week, not today's.
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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token } = req.query;

  const { data: mentee, error } = await supabase
    .from('mentees')
    .select('id, name, onboard_date')
    .eq('token', token)
    .single();

  if (error || !mentee) return res.status(404).json({ error: 'Mentee not found' });

  const todayStr = pacificDateString();
  const [currentWeekStart, currentWeekEnd] = mondayOf(todayStr);

  // Default view is the current week. A GET may ask for a past week via
  // ?week_start=YYYY-MM-DD — normalized to that date's Monday regardless
  // of which day of the week was passed in. Future weeks are rejected.
  let weekStart = currentWeekStart, weekEnd = currentWeekEnd;
  if (req.query.week_start) {
    const [reqStart, reqEnd] = mondayOf(req.query.week_start);
    if (reqStart > currentWeekStart) {
      return res.status(400).json({ error: 'Cannot view a future week.' });
    }
    weekStart = reqStart;
    weekEnd = reqEnd;
  }

  const week = programWeekForRange(mentee.onboard_date, weekStart);
  const editable = weekStart === currentWeekStart;

  // History floor = whichever is LATER: the mentee's onboard week, or the
  // week this feature actually launched. Prevents scrolling into weeks
  // that predate real data.
  const onboardFloor = mondayOf(mentee.onboard_date || todayStr)[0];
  const launchFloor = mondayOf(FEATURE_LAUNCH_DATE)[0];
  const earliestWeekStart = onboardFloor > launchFloor ? onboardFloor : launchFloor;

  if (req.method === 'GET') {
    const { data: entries } = await supabase
      .from('daily_activity')
      .select('*')
      .eq('mentee_id', mentee.id)
      .gte('entry_date', weekStart)
      .lte('entry_date', weekEnd)
      .order('entry_date', { ascending: true });

    return res.status(200).json({
      mentee: { name: mentee.name },
      today: todayStr,
      week_start: weekStart,
      week_end: weekEnd,
      program_week: week,
      editable,
      current_week_start: currentWeekStart,
      earliest_week_start: earliestWeekStart,
      targets: METRICS.filter(m => !m.derived).reduce((acc, m) => {
        acc[m.key] = { label: m.label, weight: m.weight, target: targetFor(m, week) };
        return acc;
      }, {}),
      derived_targets: METRICS.filter(m => m.derived).reduce((acc, m) => {
        acc[m.key] = { label: m.label, weight: m.weight, target: targetFor(m, week) };
        return acc;
      }, {}),
      entries: entries || []
    });
  }

  if (req.method === 'POST') {
    const { entry_date, ...values } = req.body;

    // Editable window: CURRENT calendar week only. Uses currentWeekStart/
    // currentWeekEnd, not the (possibly historical) weekStart/weekEnd above —
    // so a GET made against a past week can never leak into what POST allows.
    if (entry_date < currentWeekStart || entry_date > currentWeekEnd) {
      return res.status(403).json({ error: 'That date is outside the current editable week.' });
    }

    const allowedKeys = ['leadgen_hours', 'new_conversations', 'followup_conversations',
      'roleplay_sessions', 'database_contacts', 'open_houses', 'social_posts'];
    const row = { mentee_id: mentee.id, entry_date };
    for (const k of allowedKeys) {
      if (values[k] !== undefined) row[k] = Number(values[k]) || 0;
    }

    const { data, error: upsertError } = await supabase
      .from('daily_activity')
      .upsert(row, { onConflict: 'mentee_id,entry_date' })
      .select()
      .single();

    if (upsertError) return res.status(500).json({ error: upsertError.message });
    return res.status(200).json({ success: true, entry: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
