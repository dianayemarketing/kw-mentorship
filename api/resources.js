const MONDAY_API_URL = 'https://api.monday.com/v2';
const BOARD_ID = '18409934917';

export default async function handler(req, res) {
  // Allow browser to call this endpoint
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

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
              column_values(ids: ["color_mm2pg0xb"]) {
                id text
              }
              subitems {
                id
                name
                column_values(ids: ["link_mm2pev2e", "dropdown_mm2pkbpn", "long_text_mm2p4681"]) {
                  id text value
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.MONDAY_API_TOKEN
      },
      body: JSON.stringify({ query })
    });

    const json = await response.json();
    const groups = json?.data?.boards?.[0]?.groups || [];

    // ── Build "Also Show In" cross-reference map ──────────────────────────
    // Scans every subitem's "Also Show In" field (long_text_mm2p4681).
    // Produces: { "item name (lowercase)" -> [subitem, subitem, ...] }
    const alsoShowMap = {};
    groups.forEach(group => {
      (group.items_page?.items || []).forEach(item => {
        (item.subitems || []).forEach(sub => {
          const alsoCol = sub.column_values?.find(c => c.id === 'long_text_mm2p4681');
          const raw = alsoCol?.text || '';
          if (!raw.trim()) return;
          raw.split(',')
            .map(s => s.trim().toLowerCase())
            .filter(Boolean)
            .forEach(targetName => {
              if (!alsoShowMap[targetName]) alsoShowMap[targetName] = [];
              alsoShowMap[targetName].push(sub);
            });
        });
      });
    });

    // ── Inject cross-referenced subitems into their target items ──────────
    // Appends extras to item.subitems, deduped by subitem ID.
    groups.forEach(group => {
      (group.items_page?.items || []).forEach(item => {
        const extras = alsoShowMap[item.name.toLowerCase().trim()] || [];
        if (!extras.length) return;
        const ownIds = new Set((item.subitems || []).map(s => s.id));
        const newOnes = extras.filter(s => !ownIds.has(s.id));
        if (newOnes.length) {
          item.subitems = [...(item.subitems || []), ...newOnes];
        }
      });
    });

    // Cache for 5 minutes — reduces Monday API calls
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json({ groups });

  } catch (e) {
    console.error('Resources fetch error:', e);
    return res.status(500).json({ error: 'Failed to load resources' });
  }
}
