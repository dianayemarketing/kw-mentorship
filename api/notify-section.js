// api/notify-section.js
// Called from mentee.html when a checklist section reaches 100% completion.
// Uses the Anthropic API with Gmail MCP to send an alert email to the mentor.
//
// Required env vars (already set in Vercel):
//   ANTHROPIC_API_KEY  — your Anthropic API key
//   MENTOR_EMAIL       — email to notify (e.g. dianaye@kw.com)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { menteeName, sectionName, sectionIndex, totalSections, pct } = req.body;

  if (!menteeName || !sectionName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const apiKey      = process.env.ANTHROPIC_API_KEY;
  const mentorEmail = process.env.MENTOR_EMAIL || 'dianaye@kw.com';

  if (!apiKey) {
    console.warn('ANTHROPIC_API_KEY not set — skipping notification');
    return res.status(200).json({ success: true, skipped: true });
  }

  const isFullProgram = pct >= 100;

  const subject = isFullProgram
    ? `🎓 ${menteeName} completed the full 10-week program!`
    : `✅ ${menteeName} finished "${sectionName}"`;

  const emailBody = isFullProgram
    ? `Hi Diana,\n\n🎓 Big news — ${menteeName} has completed ALL ${totalSections} sections of the KW Thrive Chinese Mentorship Program at ${pct}% overall completion!\n\nThis is a major milestone. Time to schedule their Graduation Debrief and celebrate their achievement.\n\nReview their full checklist: https://kw-mentorship.vercel.app\n\n— KW Thrive Mentorship System`
    : `Hi Diana,\n\n${menteeName} just completed "${sectionName}" (section ${sectionIndex + 1} of ${totalSections}).\n\nOverall program progress: ${pct}%\n\nReview their full checklist: https://kw-mentorship.vercel.app\n\n— KW Thrive Mentorship System`;

  const prompt = `Please send an email using Gmail with exactly these details — do not change the subject or body:

To: ${mentorEmail}
Subject: ${subject}
Body:
${emailBody}

Send it now and confirm once done.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        mcp_servers: [
          {
            type: 'url',
            url: 'https://gmailmcp.googleapis.com/mcp/v1',
            name: 'gmail'
          }
        ],
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(200).json({ success: false, error: data.error?.message });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('notify-section error:', err);
    return res.status(200).json({ success: false, error: err.message });
  }
}
