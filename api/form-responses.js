const SHEET_ID = '1puKAoaMejV929AGMDA08EFYYemDNgQh7tucTEdE6YNU';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).map(line => {
    const values = line.match(/(".*?"|[^,]+)(?=,|$)/g) || [];
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] || '').replace(/^"|"$/g, '').trim();
    });
    return row;
  });
}

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers['x-mentor-password'];
  if (auth !== process.env.MENTOR_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const csvRes = await fetch(SHEET_CSV_URL);
    const csvText = await csvRes.text();
    const rows = parseCSV(csvText);

    // Filter to this week's submissions
    const weekStart = getWeekStart();
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const thisWeek = rows.filter(row => {
      const ts = new Date(row['Timestamp']);
      return ts >= weekStart && ts < weekEnd;
    });

    // Return list of submitters: email + name
    const submitters = thisWeek.map(row => ({
      email: (row['Email Address'] || '').toLowerCase().trim(),
      name: (row['Name'] || '').trim(),
      timestamp: row['Timestamp'],
      date: row['Date'] || ''
    }));

    return res.status(200).json({ submitters, week_start: weekStart.toISOString() });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
