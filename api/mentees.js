import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TOTAL_TASKS = 113; // total tasks across all weeks

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers['x-mentor-password'];
  if (auth !== process.env.MENTOR_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: mentees, error } = await supabase
      .from('mentees')
      .select('*')
      .order('name');

    if (error) throw error;

    // For each mentee, get their progress
    const results = await Promise.all(mentees.map(async (m) => {
      const { data: progress } = await supabase
        .from('checklist_progress')
        .select('section_index, task_index, completed, updated_at')
        .eq('mentee_id', m.id)
        .eq('completed', true);

      const doneTasks = progress?.length || 0;
      const pct = Math.round((doneTasks / TOTAL_TASKS) * 100);

      // Determine current week based on sections completed
      const sectionCounts = [20, 17, 11, 10, 6, 27, 18, 15, 13]; // tasks per section
      let sectionsDone = 0;
      for (let si = 0; si < sectionCounts.length; si++) {
        const sectionDone = progress?.filter(p => p.section_index === si).length || 0;
        if (sectionDone < sectionCounts[si]) {
          sectionsDone = si;
          break;
        }
        sectionsDone = si + 1;
      }

      const weekLabels = ['Prerequisites','Week 1','Week 2','Week 3','Week 4','Weeks 5–6','Weeks 7–8','Weeks 9–10','Weeks 11–12'];
      const currentWeek = sectionsDone >= weekLabels.length ? 'Completed' : weekLabels[sectionsDone];

      const lastActivity = progress?.length
        ? progress.sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at))[0]?.updated_at
        : null;

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
        pct,
        done_tasks: doneTasks,
        total_tasks: TOTAL_TASKS,
        current_week: currentWeek,
        last_activity: lastActivity
      };
    }));

    return res.status(200).json({ mentees: results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
