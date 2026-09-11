// Intended repo path: api/gate-webhook.js
//
// Subscribe this URL to the "Readiness Gate Reviews" board (18430429768) for
// event types: create_item, change_column_value (or change_multiple_column_values).
// Register via Monday API (create_webhook mutation) once this is deployed —
// Monday will POST a { challenge } payload first; echo it back to verify.
//
// On every event we re-fetch the FULL item (not just the changed column) and
// upsert it. This is deliberate: a single form submission fires several rapid
// column-change events, and re-deriving from the complete item each time means
// we never have to reassemble partial payloads — the row just converges to the
// final state after the last event lands.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MONDAY_API_URL = 'https://api.monday.com/v2';
const GATE_BOARD_ID = 18430429768;

// Column IDs pulled live from board 18430429768 via get_board_info — do not
// hand-type these, they don't follow a guessable pattern.
const MENTEE_COL = 'connect_boards8viuu7';
const GATE_COL = 'single_selectqe7nsxb';
const NOTES_COL = 'long_text63omrsmh';
const REVIEWER_COL = 'color_mm72mrvb';
const DATE_COL = 'date_mm72ray8';

// Maps the Gate/Week label (as stored in Monday) to our internal gate_key and
// the ordered list of competency columns that belong to that gate. Keep this
// in sync with GATE_DEFS in mentee.html and readiness-gates-column-explainer.md.
const GATE_MAP = {
  'Wk1 - Foundation': {
    key: 'wk1_foundation',
    competencies: [
      { id: 'number6xgu53n9', label: 'Time-Blocking / Calendar Discipline' },
      { id: 'numberwcx4d11t', label: 'USP / Value Proposition' },
      { id: 'numberll8cmjk5', label: 'Market Explanation' }
    ]
  },
  'Wk2 - Lead Gen': {
    key: 'wk2_leadgen',
    competencies: [
      { id: 'numberscd466hl', label: 'CRM / Database Organization' },
      { id: 'numberhi60bcvu', label: 'Lead-Source Plan (3+1)' },
      { id: 'numbern0novwgy', label: 'Sphere / Referral Conversations' },
      { id: 'number1b3669xh', label: 'Open-House Execution' },
      { id: 'numberu5f170aq', label: 'Script Fluency' },
      { id: 'numberkvcvk21i', label: 'Objection Handling' }
    ]
  },
  'Wk3 - Buyer Consult': {
    key: 'wk3_buyerconsult',
    competencies: [
      { id: 'number8unsuawj', label: 'Buyer Consultation' },
      { id: 'numberwilw30bq', label: 'Agency / Representation Explanation' },
      { id: 'numberhwq6vadw', label: 'Financing Basics' },
      { id: 'numberdz75lkf0', label: 'Professional Showings' },
      { id: 'number4f7fmfz6', label: 'Buyer CMA' }
    ]
  },
  'Wk4 - Offer': {
    key: 'wk4_offer',
    competencies: [
      { id: 'number06uawqbi', label: 'Purchase Agreement Completion' },
      { id: 'numbert97k8vuo', label: 'Terms / Contingency Explanation' },
      { id: 'numberz5l6otvp', label: 'Offer Strategy' },
      { id: 'numbersrvqiefq', label: 'E-Signature Platform Use' }
    ]
  },
  'Wk5 - Transaction': {
    key: 'wk5_transaction',
    competencies: [
      { id: 'number7rlqroh8', label: 'Escrow / Title / Lender Roles' },
      { id: 'numberbsew0gyd', label: 'Deadline / Contingency Tracking' },
      { id: 'numberlri2tvqb', label: 'Inspections / Disclosures' },
      { id: 'numberv9nccw1l', label: 'Proactive Client Updates' }
    ]
  },
  'Wk6 - Listing': {
    key: 'wk6_listing',
    competencies: [
      { id: 'number4ex210ed', label: 'Listing Consultation' },
      { id: 'number4q0s4cwz', label: 'Seller CMA / Pricing Strategy' },
      { id: 'numberbvni1dz7', label: 'Listing Agreement' },
      { id: 'numbercirykvpa', label: 'Seller Disclosure Requirements' }
    ]
  },
  'Wk8 - Negotiation': {
    key: 'wk8_negotiation',
    competencies: [
      { id: 'numberulm19mfh', label: 'Presenting Offers / Counters' },
      { id: 'number7dfufpzb', label: 'Multiple-Offer Scenarios' },
      { id: 'numbergrypxkfq', label: 'Difficult Client Conversations' },
      { id: 'numberpfcun3cg', label: 'Professionalism' }
    ]
  },
  '90-Day - Level 1': {
    key: 'day90_level1',
    competencies: [
      { id: 'number8ah2m180', label: '1-Year Business Plan / Budget' },
      { id: 'number0qum9la0', label: 'Compliance Module Complete' },
      { id: 'numberybteak8l', label: 'Transaction 1 (Do It With Me)' },
      { id: 'numberrdx4hely', label: 'Transaction 2 (Do It With Support)' },
      { id: 'number5v75xgn1', label: 'Transaction 3 (Show Me You Can)' }
    ]
  }
};

async function fetchItem(itemId) {
  const query = `
    query ($ids: [ID!]) {
      items(ids: $ids) {
        id
        board { id }
        column_values { id text value }
      }
    }
  `;
  const resp = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': process.env.MONDAY_API_TOKEN
    },
    body: JSON.stringify({ query, variables: { ids: [String(itemId)] } })
  });
  const json = await resp.json();
  return json?.data?.items?.[0] || null;
}

function colText(columnValues, id) {
  return columnValues.find(c => c.id === id)?.text ?? '';
}

async function syncItem(itemId) {
  const item = await fetchItem(itemId);
  if (!item) return;
  if (String(item.board?.id) !== String(GATE_BOARD_ID)) return; // ignore other boards, just in case

  const cols = item.column_values;

  const gateLabel = colText(cols, GATE_COL).trim();
  const gateDef = GATE_MAP[gateLabel];
  if (!gateDef) return; // no gate picked yet — nothing to sync

  const menteeRaw = cols.find(c => c.id === MENTEE_COL)?.value;
  let mondayMenteeId = null;
  try {
    const parsed = menteeRaw ? JSON.parse(menteeRaw) : null;
    mondayMenteeId = parsed?.linkedPulseIds?.[0]?.linkedPulseId || null;
  } catch (e) { /* leave null */ }
  if (!mondayMenteeId) return; // no mentee linked yet — nothing to sync

  const { data: mentee } = await supabase
    .from('mentees')
    .select('id')
    .eq('monday_item_id', String(mondayMenteeId))
    .single();
  if (!mentee) return; // mentee link points somewhere we don't track (e.g. test data)

  const competencies = gateDef.competencies.map(c => {
    const raw = colText(cols, c.id);
    const score = raw === '' ? null : Number(raw);
    return { label: c.label, score };
  });

  const allScored = competencies.every(c => c.score !== null);
  const allPass = competencies.every(c => c.score !== null && c.score >= 3);
  const passFail = !allScored ? 'Needs Follow-Up' : (allPass ? 'Pass' : 'Needs Follow-Up');

  await supabase.from('readiness_gates').upsert({
    mentee_id: mentee.id,
    monday_item_id: String(item.id),
    gate_key: gateDef.key,
    gate_label: gateLabel,
    pass_fail: passFail,
    competencies,
    reviewer: colText(cols, REVIEWER_COL),
    eval_date: colText(cols, DATE_COL),
    coach_notes: colText(cols, NOTES_COL)
  }, { onConflict: 'monday_item_id' });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Monday's webhook verification handshake
  if (req.body?.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  const event = req.body?.event;
  const itemId = event?.pulseId || event?.itemId;
  if (!itemId) return res.status(200).json({ ok: true });

  try {
    await syncItem(itemId);
  } catch (e) {
    console.error('Gate webhook sync failed:', e);
    // Still 200 — Monday retries/disables webhooks that error, and a failed
    // sync here just means a stale row until the next column edit re-fires it.
  }

  return res.status(200).json({ ok: true });
}
