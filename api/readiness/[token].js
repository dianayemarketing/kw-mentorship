// Intended repo path: api/readiness/[token].js
// Read-only. Deliberately does NOT return coach_notes — mentee-facing scope is
// gate status + per-competency scores only, per Diana's decision. Notes stay
// in Supabase for a future mentor-side view.
//
// ADDED 2026-09-16: live "Pending Review" lookup against the Gate Evidence
// Submissions board (18431260768). No new table, no new function — this is
// a read-time merge only. For any gate that has NO scored row yet in
// readiness_gates, we check whether a submission already exists for this
// mentee's token + that gate on the Monday board, and if so report
// pass_fail: 'Pending Review' instead of leaving the gate blank.
//
// Fails soft: if the Monday call errors or times out, we log it and return
// the Supabase-only result unchanged — a slow/broken Monday API must never
// break the Readiness Gate tab.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MONDAY_API_URL = 'https://api.monday.com/v2';
const SUBMISSIONS_BOARD_ID = 18431260768;
const SUBMISSIONS_TOKEN_COL = 'short_textxixz9afx';
const SUBMISSIONS_GATE_COL = 'single_selectpi8ixg2';

// Gate/Week label -> gate_key. KEEP IN SYNC with GATE_MAP in api/gate-webhook.js
// and the Gate Evidence Submissions form's "Which gate is this for?" options —
// both use these exact label strings.
const LABEL_TO_GATE_KEY = {
  'Wk1 - Foundation': 'wk1_foundation',
  'Wk2 - Lead Gen': 'wk2_leadgen',
  'Wk3 - Buyer Consult': 'wk3_buyerconsult',
  'Wk4 - Offer': 'wk4_offer',
  'Wk5 - Transaction': 'wk5_transaction',
  'Wk6 - Listing': 'wk6_listing',
  'Wk8 - Negotiation': 'wk8_negotiation',
  '90-Day - Level 1': 'day90_level1'
};

// Returns a Set of gate_keys with at least one submission for this token.
// Never throws — a failure here just yields an empty set upstream.
async function pendingGateKeysForToken(token) {
  const query = `
    query ($boardId: [ID!], $token: String!) {
      boards(ids: $boardId) {
        items_page(
          query_params: {
            rules: [{ column_id: "${SUBMISSIONS_TOKEN_COL}", compare_value: [$token], operator: any_of }]
          }
        ) {
          items {
            column_values(ids: ["${SUBMISSIONS_GATE_COL}"]) { text }
          }
        }
      }
    }
  `;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const resp = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.MONDAY_API_TOKEN
      },
      body: JSON.stringify({ query, variables: { boardId: String(SUBMISSIONS_BOARD_ID), token } }),
      signal: controller.signal
    });
    const json = await resp.json();
    const items = json?.data?.boards?.[0]?.items_page?.items || [];

    const keys = new Set();
    items.forEach(item => {
      const label = item.column_values?.[0]?.text;
      const key = LABEL_TO_GATE_KEY[label];
      if (key) keys.add(key);
    });
    return keys;
  } catch (e) {
    console.error('Pending-review lookup failed (non-fatal):', e.message);
    return new Set();
  } finally {
    clearTimeout(timeout);
  }
}

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

  const scoredGates = gates || [];
  const scoredKeys = new Set(scoredGates.map(g => g.gate_key));

  // Only worth calling Monday if there's at least one un-scored gate to check.
  const hasUnscoredGate = Object.values(LABEL_TO_GATE_KEY).some(k => !scoredKeys.has(k));
  const pendingKeys = hasUnscoredGate ? await pendingGateKeysForToken(token) : new Set();

  const pendingOnly = [...pendingKeys]
    .filter(key => !scoredKeys.has(key))
    .map(key => ({
      gate_key: key,
      gate_label: null,
      pass_fail: 'Pending Review',
      competencies: null,
      eval_date: null,
      reviewer: null
    }));

  return res.status(200).json({ gates: [...scoredGates, ...pendingOnly] });
}
