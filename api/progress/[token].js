import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MONDAY_API_URL = 'https://api.monday.com/v2';
const BOARD_ID = '18383986088';

async function pushToMonday(mondayItemId, pct, currentWeek) {
  // First ensure columns exist (they may already be created)
  const mutation = `
    mutation {
      change_multiple_column_values(
        board_id: ${BOARD_ID},
        item_id: ${mondayItemId},
        column_values: "{\\"text_checklist_pct\\": \\"${pct}%\\", \\"text_current_week\\": \\"${currentWeek}\\"}"
      ) { id }
    }
  `;
  try {
    await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.MONDAY_API_TOKEN
      },
      body: JSON.stringify({ query: mutation })
    });
  } catch (e) {
    console.error('Monday push error:', e);
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token } = req.query;

  // GET: load mentee + their progress
  if (req.method === 'GET') {
    const { data: mentee, error } = await supabase
      .from('mentees')
      .select('*')
      .eq('token', token)
      .single();

    if (error || !mentee) return res.status(404).json({ error: 'Mentee not found' });

    const { data: progress } = await supabase
      .from('checklist_progress')
      .select('section_index, task_index, completed')
      .eq('mentee_id', mentee.id);

    return res.status(200).json({
      mentee: {
        id: mentee.id,
        name: mentee.name,
        onboard_date: mentee.onboard_date,
        work_email: mentee.work_email,
        personal_email: mentee.personal_email
      },
      progress: progress || []
    });
  }

  // POST: save a task check/uncheck
  if (req.method === 'POST') {
    const { section_index, task_index, completed } = req.body;

    const { data: mentee } = await supabase
      .from('mentees')
      .select('id, monday_item_id')
      .eq('token', token)
      .single();

    if (!mentee) return res.status(404).json({ error: 'Mentee not found' });

    await supabase.from('checklist_progress').upsert({
      mentee_id: mentee.id,
      section_index,
      task_index,
      completed,
      completed_at: completed ? new Date().toISOString() : null
    }, { onConflict: 'mentee_id,section_index,task_index' });

    // Recalculate progress for Monday push
    const { data: allProgress } = await supabase
      .from('checklist_progress')
      .select('section_index, completed')
      .eq('mentee_id', mentee.id)
      .eq('completed', true);

    const TOTAL_TASKS = 113;
    const doneTasks = allProgress?.length || 0;
    const pct = Math.round((doneTasks / TOTAL_TASKS) * 100);

    const sectionCounts = [20, 17, 11, 10, 6, 27, 18, 15, 13];
    const weekLabels = ['Prerequisites','Week 1','Week 2','Week 3','Week 4','Weeks 5–6','Weeks 7–8','Weeks 9–10','Weeks 11–12'];
    let currentWeekIdx = 0;
    for (let si = 0; si < sectionCounts.length; si++) {
      const sectionDone = allProgress?.filter(p => p.section_index === si).length || 0;
      if (sectionDone < sectionCounts[si]) { currentWeekIdx = si; break; }
      currentWeekIdx = si + 1;
    }
    const currentWeek = currentWeekIdx >= weekLabels.length ? 'Completed' : weekLabels[currentWeekIdx];

    // Push to Monday async (don't await — keep response fast)
    pushToMonday(mentee.monday_item_id, pct, currentWeek);

    return res.status(200).json({ success: true, pct, current_week: currentWeek });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
