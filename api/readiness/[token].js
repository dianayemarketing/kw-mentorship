// Intended repo path: api/readiness/[token].js
// Read-only. Deliberately does NOT return coach_notes — mentee-facing scope is
// gate status + per-competency scores only, per Diana's decision. Notes stay
// in Supabase for a future mentor-side view.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query;

  const { data: mentee, error } = await supabase
    .from('mentees')
    .select('id')
    .eq('token', token)
    .single();

  if (error || !mentee) return res.status(404).json({ error: 'Mentee not found' });

  const { data: gates } = await supabase
    .from('readiness_gates')
    .select('gate_key, gate_label, pass_fail, competencies, eval_date, reviewer')
    .eq('mentee_id', mentee.id);

  return res.status(200).json({ gates: gates || [] });
}
