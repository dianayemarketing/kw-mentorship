// Intended repo path: api/mentor/gates.js
// Read-only, password-gated (mentor dashboard only). Returns every active
// mentee's readiness_gates rows shaped as a mentee x gate matrix, mirroring
// the Monday "All Gates - Master" view. Gate keys kept in sync with
// GATE_DEFS in mentee.html and GATE_MAP in api/gate-webhook.js.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const GATE_KEYS = [
  'wk1_foundation', 'wk2_leadgen', 'wk3_buyerconsult', 'wk4_offer',
  'wk5_transaction', 'wk6_listing', 'wk8_negotiation', 'day90_level1'
];

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers['x-mentor-password'];
  if (auth !== process.env.MENTOR_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
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

    return res.status(200).json({ mentees: results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
