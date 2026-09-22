// Intended repo path: api/mentor.js
// Replaces api/mentor/gates.js, api/mentor/graduation.js, api/mentor/scorecard.js.
// Merged only to stay under the Hobby-plan 12-serverless-function cap — logic
// is unchanged from the three originals, just routed by ?view= instead of by
// file path. Delete the old three files from api/mentor/ after this deploys,
// and update the mentor dashboard's fetch calls (see bottom of this comment).
//
// Old -> New:
//   GET /api/mentor/gates       -> GET /api/mentor?view=gates
//   GET /api/mentor/graduation  -> GET /api/mentor?view=graduation
//   GET /api/mentor/scorecard   -> GET /api/mentor?view=scorecard
// Same header required on all three: x-mentor-password.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const GATE_KEYS = [
  'wk1_foundation', 'wk2_leadgen', 'wk3_buyerconsult', 'wk4_offer',
  'wk5_transaction', 'wk6_listing', 'wk8_negotiation', 'day90_level1'
];

const TZ = 'America/Los_Angeles';

function pacificDateString(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

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

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr + 'T00:00:00Z')) / 86400000);
}

// KEEP IN SYNC with METRICS in api/daily-activity/[token].js and mentee.html.
// OPEN ITEM (carried over from scorecard.js, not resolved here): the Level 1
// Launch spec lists New RE Conversations at 18/week; the value below (35) is
// what's actually shipped in api/daily-activity/[token].js. Left as-is —
// this mirrors what's LIVE, not the spec.
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

function targetFor(metric, week) {
  if (week <= 4) return metric.ramp[week - 1];
  return metric.flat;
}

function trafficFor(pct) {
  if (pct >= 85) return 'green';
  if (pct >= 60) return 'amber';
  return 'red';
}

async function handleGates() {
  const { data: mentees, error: mErr } = await supabase
    .from('mentees')
    .select('id, name')
    .eq('is_active', true)
    .order('name');
  if (mErr) throw mErr;

  const { data: gates, error: gErr } = await supabase
    .from('readiness_gates')
    .select('mentee_id, gate_key, pass_fail, eval_date, reviewer');
  if (gErr) throw gErr;

  const byMentee = {};
  (gates || []).forEach(g => {
    if (!byMentee[g.mentee_id]) byMentee[g.mentee_id] = {};
    byMentee[g.mentee_id][g.gate_key] = g;
  });

  const results = mentees.map(m => ({
    mentee_id: m.id,
    name: m.name,
    gates: GATE_KEYS.map(key => {
      const row = byMentee[m.id]?.[key];
      return {
        gate_key: key,
        status: row ? row.pass_fail : 'Not Yet Reviewed', // "Pass" | "Needs Follow-Up" | "Not Yet Reviewed"
        eval_date: row?.eval_date || null,
        reviewer: row?.reviewer || null
      };
    })
  }));

  return { mentees: results };
}

async function handleGraduation() {
  const { data: mentees, error: mErr } = await supabase
    .from('mentees')
    .select('id, name, onboard_date, transactions_count, state_compliance, graduation_flag')
    .eq('is_active', true)
    .order('name');
  if (mErr) throw mErr;

  const { data: gates, error: gErr } = await supabase
    .from('readiness_gates')
    .select('mentee_id, gate_key, pass_fail');
  if (gErr) throw gErr;

  const gatesByMentee = {};
  (gates || []).forEach(g => {
    if (!gatesByMentee[g.mentee_id]) gatesByMentee[g.mentee_id] = {};
    gatesByMentee[g.mentee_id][g.gate_key] = g.pass_fail;
  });

  const results = mentees.map(m => {
    const daysIn = daysSince(m.onboard_date);
    const trainingComplete = daysIn !== null && daysIn >= 90;

    const menteeGates = gatesByMentee[m.id] || {};
    const allGatesPass = GATE_KEYS.every(k => menteeGates[k] === 'Pass');

    const txnCount = m.transactions_count || 0;
    const items = [
      { key: 'training', label: '90-day training completed',        done: trainingComplete },
      { key: 'gates',    label: 'All 8 readiness gates passed',     done: allGatesPass },
      { key: 'state',    label: 'State/local compliance module',    done: !!m.state_compliance },
      { key: 'txn1',     label: 'Transaction #1 — Do it with me',   done: txnCount >= 1 },
      { key: 'txn2',     label: 'Transaction #2 — Do it with support', done: txnCount >= 2 },
      { key: 'txn3',     label: 'Transaction #3 — Show me you can do it', done: txnCount >= 3 },
      { key: 'signoff',  label: 'Coach final sign-off',             done: m.graduation_flag === 'Yes' }
    ];

    const doneCount = items.filter(i => i.done).length;
    const rulesEligible = items.every(i => i.done);
    const coachSaysYes = m.graduation_flag === 'Yes';

    return {
      mentee_id: m.id,
      name: m.name,
      days_in_program: daysIn,
      items,
      done_count: doneCount,
      total_items: items.length,
      certificate_status: coachSaysYes
        ? 'Certified'
        : (rulesEligible ? 'Rules met — awaiting sign-off' : 'In progress'),
      mismatch: coachSaysYes && !rulesEligible
    };
  });

  return { mentees: results };
}

async function handleScorecard() {
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

  return { week_start: weekStart, week_end: weekEnd, mentees: results };
}

async function handleScorecardDaily(menteeId, weekStartParam) {
  const { data: mentee, error: mErr } = await supabase
    .from('mentees')
    .select('id, name')
    .eq('id', menteeId)
    .single();
  if (mErr) throw mErr;

  const todayStr = pacificDateString();
  const [ws, we] = mondayOf(weekStartParam || todayStr);

  const { data: entries } = await supabase
    .from('daily_activity')
    .select('*')
    .eq('mentee_id', menteeId)
    .gte('entry_date', ws)
    .lte('entry_date', we);

  const byDate = {};
  (entries || []).forEach(e => { byDate[e.entry_date] = e; });

  const dailyMetrics = METRICS.filter(mt => !mt.derived);

  const days = [];
  const cursor = new Date(ws + 'T12:00:00Z');
  for (let i = 0; i < 7; i++) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const e = byDate[dateStr];
    const values = {};
    dailyMetrics.forEach(mt => { values[mt.key] = e ? (Number(e[mt.key]) || 0) : null; });
    days.push({ date: dateStr, logged: !!e, values });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    mentee_id: mentee.id,
    name: mentee.name,
    week_start: ws,
    week_end: we,
    metrics: dailyMetrics.map(mt => ({ key: mt.key, label: mt.label })),
    days
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers['x-mentor-password'];
  if (auth !== process.env.MENTOR_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const view = req.query.view;

  try {
    let payload;
    if (view === 'gates') payload = await handleGates();
    else if (view === 'graduation') payload = await handleGraduation();
    else if (view === 'scorecard') payload = await handleScorecard();
    else if (view === 'scorecard-daily') {
      const menteeId = req.query.mentee_id;
      if (!menteeId) return res.status(400).json({ error: 'mentee_id is required for scorecard-daily' });
      payload = await handleScorecardDaily(menteeId, req.query.week_start);
    }
    else return res.status(400).json({ error: 'Unknown or missing ?view= — expected gates, graduation, scorecard, or scorecard-daily' });

    return res.status(200).json(payload);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
