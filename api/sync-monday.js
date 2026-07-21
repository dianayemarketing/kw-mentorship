import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MONDAY_API_URL = 'https://api.monday.com/v2';
const BOARD_ID = '18383986088';
const ACTIVE_GROUP_ID = 'topics';        // Signed Mentee
const PAUSED_GROUP_ID = 'group_mm12kcan'; // Paused
const SITE_URL = 'https://kw-mentorship.vercel.app';

async function fetchMondayMentees() {
  const query = `
    query {
      boards(ids: [${BOARD_ID}]) {
        groups {
          id
          title
          items_page(limit: 100) {
            items {
              id
              name
              column_values(ids: ["text_mkxv9drn","text_mkxvtxbk","email_mm1wde8k","date4","link_mm38b5mj"]) {
                id
                text
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': process.env.MONDAY_API_TOKEN
    },
    body: JSON.stringify({ query })
  });

  const data = await res.json();
  return data.data.boards[0].groups;
}

async function writeMondayLink(itemId, token) {
  const url = `${SITE_URL}/mentee/${token}`;
  const mutation = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) {
        id
      }
    }
  `;

  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': process.env.MONDAY_API_TOKEN
    },
    body: JSON.stringify({
      query: mutation,
      variables: {
        boardId: BOARD_ID,
        itemId: itemId,
        columnId: 'link_mm38b5mj',
        value: JSON.stringify({ url, text: 'Portal Link' })
      }
    })
  });

  const data = await res.json();
  if (data.errors) {
    console.error(`Failed to write link for item ${itemId}:`, data.errors);
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers['x-mentor-password'];
  if (auth !== process.env.MENTOR_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const groups = await fetchMondayMentees();
    let added = 0, updated = 0;

    for (const group of groups) {
      // Only process Signed Mentee and Paused groups
      if (group.id !== ACTIVE_GROUP_ID && group.id !== PAUSED_GROUP_ID) continue;

      const isActive = group.id === ACTIVE_GROUP_ID;

      for (const item of group.items_page.items) {
        const colMap = {};
        item.column_values.forEach(c => { colMap[c.id] = c.text; });

        const menteeData = {
          monday_item_id: item.id,
          name: item.name,
          mobile: colMap['text_mkxv9drn'] || null,
          work_email: colMap['text_mkxvtxbk'] || null,
          personal_email: colMap['email_mm1wde8k'] || null,
          onboard_date: colMap['date4'] || null,
          is_active: isActive  // true for Signed Mentee, false for Paused
        };

        const { data: existing } = await supabase
          .from('mentees')
          .select('id, token')
          .eq('monday_item_id', item.id)
          .single();

        let token;
        if (existing) {
          await supabase.from('mentees')
            .update(menteeData)
            .eq('monday_item_id', item.id);
          token = existing.token;
          updated++;
        } else {
          const { data: inserted } = await supabase
            .from('mentees')
            .insert(menteeData)
            .select('token')
            .single();
          token = inserted?.token;
          added++;
        }

        // Only write the portal link back to Monday if that column is empty —
        // never overwrite a manually-pasted link.
        const linkAlreadySet = !!(colMap['link_mm38b5mj'] || '').trim();
        if (token && !linkAlreadySet) {
          await writeMondayLink(item.id, token);
        }
      }
    }

    return res.status(200).json({ success: true, added, updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
