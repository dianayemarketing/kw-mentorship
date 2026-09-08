// Intended repo path: api/daily-activity/[token].js
// New endpoint for the Weekly Accountability Scorecard.
// Does not touch checklist_progress or the /api/progress/[token] path.
//
// TIMEZONE: hardcoded to America/Los_Angeles. Program is strictly South
// Bay agents, so the server is the sole source of truth for "today" and
// the editable-window check — no client-supplied date is trusted.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TZ = 'America/Los_Angeles';

function pacificDateString(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// 9 scorecard metrics -> weight + ramped targets (Wk1-4) + flat target (Wk5-10)
// Business-Building Day and CRM-Updated Day are DERIVED, not stored directly.
// KEEP IN SYNC with the copy of this table in mentee.html.
export const METRICS = [
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

function programWeek(onboardDate) {
  if (!onboardDate) return 1;
  const start = new Date(onboardDate + 'T00:00:00Z');
  const today = new Date(pacificDateString() + 'T00:00:00Z');
  const days = Math.floor((today - start) / 86400000);
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
  const [weekStart, weekEnd] = mondayOf(todayStr);
  const week = programWeek(mentee.onboard_date);

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

    // Editable window: current calendar week only
    if (entry_date < weekStart || entry_date > weekEnd) {
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
