// api/notify-section.js
// Sends a mentor alert email when a mentee completes a checklist section.
//
// Add these in Vercel → Project → Settings → Environment Variables:
//   GMAIL_USER    = dianaye@kw.com
//   GMAIL_PASS    = bblc aeco xapn utqc      ← paste exactly as-is, spaces included
//   MENTOR_EMAIL  = dianaye@kw.com           ← where alerts are sent

import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { menteeName, sectionName, sectionIndex, totalSections, pct } = req.body;

  if (!menteeName || !sectionName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const gmailUser   = process.env.GMAIL_USER   || 'dianaye@kw.com';
  const gmailPass   = process.env.GMAIL_PASS;
  const mentorEmail = process.env.MENTOR_EMAIL  || 'dianaye@kw.com';

  if (!gmailPass) {
    console.warn('GMAIL_PASS not set — skipping notification');
    return res.status(200).json({ success: true, skipped: true });
  }

  const isFullProgram = pct >= 100;

  const subject = isFullProgram
    ? `🎓 ${menteeName} completed the full 10-week program!`
    : `✅ ${menteeName} finished "${sectionName}"`;

  const text = isFullProgram
    ? `Hi Diana,\n\n🎓 Big news — ${menteeName} has completed ALL ${totalSections} sections of the KW Thrive Chinese Mentorship Program at ${pct}% overall completion!\n\nTime to schedule their Graduation Debrief and celebrate their achievement.\n\nReview their full checklist: https://kw-mentorship.vercel.app\n\n— KW Thrive Mentorship System`
    : `Hi Diana,\n\n${menteeName} just completed "${sectionName}" (section ${sectionIndex + 1} of ${totalSections}).\n\nOverall program progress: ${pct}%\n\nReview their full checklist: https://kw-mentorship.vercel.app\n\n— KW Thrive Mentorship System`;

  const html = isFullProgram
    ? `<div style="font-family:sans-serif;max-width:520px">
        <p>Hi Diana,</p>
        <p>🎓 <strong>Big news</strong> — <strong>${menteeName}</strong> has completed <strong>ALL ${totalSections} sections</strong> of the KW Thrive Chinese Mentorship Program at <strong>${pct}%</strong> overall!</p>
        <p>Time to schedule their Graduation Debrief. 🎉</p>
        <p><a href="https://kw-mentorship.vercel.app" style="color:#C8102E">Review their full checklist →</a></p>
        <p style="color:#aaa;font-size:11px">— KW Thrive Mentorship System</p>
      </div>`
    : `<div style="font-family:sans-serif;max-width:520px">
        <p>Hi Diana,</p>
        <p><strong>${menteeName}</strong> just completed <strong>"${sectionName}"</strong> — section ${sectionIndex + 1} of ${totalSections}.</p>
        <p>Overall progress: <strong style="color:#C8102E;font-size:22px">${pct}%</strong></p>
        <p><a href="https://kw-mentorship.vercel.app" style="color:#C8102E">Review their full checklist →</a></p>
        <p style="color:#aaa;font-size:11px">— KW Thrive Mentorship System</p>
      </div>`;

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailUser,
        pass: gmailPass   // set via GMAIL_PASS env var in Vercel
      }
    });

    await transporter.sendMail({
      from: `"KW Thrive Alerts" <${gmailUser}>`,
      to:      mentorEmail,
      subject,
      text,
      html
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('notify-section error:', err.message);
    return res.status(200).json({ success: false, error: err.message });
  }
}
