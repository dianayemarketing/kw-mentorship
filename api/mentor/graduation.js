// Intended repo path: api/mentor/graduation.js
// Read-only, password-gated. Computes the 7-item Certificate-of-Completion
// checklist per mentee: 90-day timer, all 8 readiness gates passed, state
// compliance, 3 supervised transactions — plus the coach's own Graduation
// (Yes/No) call, synced verbatim from Monday and never computed here.
//
// That last field is a deliberate override, not a rollup input: a coach can
// mark "Yes" on judgment before every rule below is satisfied, or hold "No"
// even once everything's checked. This endpoint reports both the rule-based
// progress AND the coach's flag, and flags when they disagree — it never
// substitutes one for the other.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const GATE_KEYS = [
  'wk1_foundation', 'wk2_leadgen', 'wk3_buyerconsult', 'wk4_offer',
  'wk5_transaction', 'wk6_listing', 'wk8_negotiation', 'day90_level1'
];

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr + 'T00:00:00Z')) / 86400000);
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
      const rulesEligible = items.every(i => i.done); // includes sign-off itself
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
        // A coach marked "Yes" before the checklist caught up (graded on
        // judgment) — or everything's checked but sign-off hasn't happened yet.
        mismatch: coachSaysYes && !rulesEligible
      };
    });

    return res.status(200).json({ mentees: results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
