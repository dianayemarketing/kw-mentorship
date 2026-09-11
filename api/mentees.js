// Intended repo path: api/mentees.js
//
// BUG FIX: TOTAL_TASKS was still 113 here against the real 201-task checklist
// — the same bug already fixed in api/progress/[token].js, just never carried
// over to this file. Every roster row's checklist % was wrong until this
// matched. sectionCounts/weekLabels corrected to the live 11-section CHECKLIST
// in mentee.html at the same time.
//
// CHANGE FROM LIVE VERSION: adds docusign_status, kpa_status, and gate-flag
// count/age per mentee — the fields the mentor Roster tab actually needs.
// Database and Self-Assessment status were considered and deliberately left
// out (Diana's call).

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TOTAL_TASKS = 201;
const sectionCounts = [19, 17, 15, 10, 15, 23, 21, 22, 18, 19, 22];
const weekLabels = [
  'Prerequisites', 'Week 1', 'Week 2', 'Week 3', 'Week 4',
  'Week 5', 'Week 6', 'Week 7', 'Week 8', 'Week 9', 'Week 10'
];

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers['x-mentor-password'];
  if (auth !== process.env.MENTOR_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // ← Only fetch ACTIVE mentees
    const { data: mentees, error } = await supabase
      .from('mentees')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;

    const results = await Promise.all(mentees.map(async (m) => {
      const { data: progress } = await supabase
        .from('checklist_progress')
        .select('section_index, task_index, completed, updated_at')
        .eq('mentee_id', m.id)
        .eq('completed', true);

      const doneTasks = progress?.length || 0;
      const pct = Math.round((doneTasks / TOTAL_TASKS) * 100);

      let currentWeekIdx = 0;
      for (let si = 0; si < sectionCounts.length; si++) {
        const sectionDone = progress?.filter(p => p.section_index === si).length || 0;
        if (sectionDone < sectionCounts[si]) { currentWeekIdx = si; break; }
        currentWeekIdx = si + 1;
      }
      const currentWeek = currentWeekIdx >= weekLabels.length ? 'Completed' : weekLabels[currentWeekIdx];

      const lastActivity = progress?.length
        ? progress.sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at))[0]?.updated_at
        : null;

      // Gate flags: count of "Needs Follow-Up" gates + age (days) of the
      // oldest one. Drives the roster's escalation number.
      const { data: gates } = await supabase
        .from('readiness_gates')
        .select('pass_fail, eval_date')
        .eq('mentee_id', m.id)
        .eq('pass_fail', 'Needs Follow-Up');

      const flagCount = gates?.length || 0;
      let flagAgeDays = null;
      if (flagCount > 0) {
        const dated = gates.filter(g => g.eval_date);
        if (dated.length) {
          const oldest = dated.sort((a, b) => new Date(a.eval_date) - new Date(b.eval_date))[0];
          flagAgeDays = Math.floor((Date.now() - new Date(oldest.eval_date)) / 86400000);
        }
      }

      return {
        id: m.id,
        monday_item_id: m.monday_item_id,
        name: m.name,
        work_email: m.work_email,
        personal_email: m.personal_email,
        mobile: m.mobile,
        onboard_date: m.onboard_date,
        token: m.token,
        is_active: m.is_active,
        is_full_time: m.is_full_time,     // kept for other tabs; not shown on Roster
        docusign_status: m.docusign_status,
        kpa_status: m.kpa_status,
        pct,
        done_tasks: doneTasks,
        total_tasks: TOTAL_TASKS,
        current_week: currentWeek,
        last_activity: lastActivity,
        flag_count: flagCount,
        flag_age_days: flagAgeDays
      };
    }));

    return res.status(200).json({ mentees: results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
