# KW Thrive Mentorship App — Setup Guide
**Estimated time: 25–35 minutes**

---

## What You're Setting Up

| Tool | Purpose | Cost |
|---|---|---|
| GitHub | Stores your project files | Free |
| Vercel | Hosts the web app | Free |
| Supabase | Saves mentee progress | Free |

---

## STEP 1 — Create a GitHub Account & Upload Files

1. Go to **github.com** and sign up for a free account
2. Click the **+** button → **New repository**
3. Name it: `kw-mentorship`
4. Keep it **Private**, click **Create repository**
5. Click **uploading an existing file**
6. Upload ALL the files from this folder, maintaining the folder structure:
   - `index.html`
   - `mentee.html`
   - `vercel.json`
   - `package.json`
   - `public/events.json`
   - `api/mentees.js`
   - `api/sync-monday.js`
   - `api/form-responses.js`
   - `api/progress/[token].js`
7. Click **Commit changes**

---

## STEP 2 — Create a Supabase Database

1. Go to **supabase.com** → **Start your project** (sign in with GitHub)
2. Click **New project**
   - Name: `kw-mentorship`
   - Database password: choose something strong, **save it somewhere**
   - Region: **West US (North California)** — closest to your Bay Area users
3. Wait ~2 minutes for the project to be ready
4. Click **SQL Editor** in the left sidebar
5. Click **New query**
6. Open the file `supabase-schema.sql` from this folder
7. Copy the entire contents and paste into the SQL Editor
8. Click **Run** — you should see "Success"
9. Now get your keys:
   - Click **Project Settings** → **API**
   - Copy **Project URL** → you'll need this as `SUPABASE_URL`
   - Copy **service_role** key (under "Project API keys") → you'll need this as `SUPABASE_SERVICE_KEY`
   - ⚠️ The service_role key is sensitive — never share it publicly

---

## STEP 3 — Get Your Monday API Token

1. Log into **monday.com**
2. Click your **profile picture** (bottom left) → **Administration**
3. Click **API** in the left menu
4. Copy your **Personal API token**
5. Save it — you'll need this as `MONDAY_API_TOKEN`

---

## STEP 4 — Deploy to Vercel

1. Go to **vercel.com** → **Sign up** (use your GitHub account)
2. Click **Add New** → **Project**
3. Find and select your `kw-mentorship` repository → click **Import**
4. On the configuration page, **don't change anything** yet
5. Click **Deploy** — it will fail at first, that's OK
6. Once deployed, click **Settings** → **Environment Variables**
7. Add these 4 variables one by one:

| Variable Name | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase Project URL from Step 2 |
| `SUPABASE_SERVICE_KEY` | Your Supabase service_role key from Step 2 |
| `MONDAY_API_TOKEN` | Your Monday API token from Step 3 |
| `MENTOR_PASSWORD` | Choose any password (e.g. `kwthrive2026`) |

8. After adding all 4, click **Deployments** → **Redeploy** on your latest deployment
9. Your app is now live! Vercel gives you a URL like `kw-mentorship-abc123.vercel.app`

---

## STEP 5 — Load Your Mentees

1. Open your app URL in the browser
2. Enter your `MENTOR_PASSWORD`
3. Click **Sync from Monday** button in the top right
4. All 14 mentees will be imported automatically

---

## STEP 6 — Get Each Mentee's Link

1. On the mentor dashboard, each mentee card has a **Copy link** button
2. Click it to copy their unique private URL
3. Send this URL to the mentee via WeChat or email during onboarding
4. That's it — they open the link and start checking off tasks

---

## STEP 7 — Update Events

To add or change upcoming events:

1. Go to your GitHub repository
2. Click on `public/events.json`
3. Click the **pencil icon** to edit
4. Update the events in the format shown
5. Click **Commit changes**
6. Vercel auto-deploys in ~30 seconds

**Event format:**
```json
{
  "date": "Apr 18, 2026",
  "day": "Friday",
  "time": "10:00 AM",
  "title": "Agent Mastermind",
  "description": "Weekly group training session",
  "location": "KW Thrive Office",
  "type": "weekly"
}
```

---

## Adding New Mentees Later

When you add someone new in Monday.com:
1. Open the mentor dashboard
2. Click **Sync from Monday**
3. The new mentee appears instantly with their checklist link ready to copy

---

## Troubleshooting

**"Unauthorized" error on login**
→ Double-check your `MENTOR_PASSWORD` environment variable in Vercel matches exactly what you're typing

**Mentees not loading after sync**
→ Check your `MONDAY_API_TOKEN` in Vercel environment variables — make sure there are no extra spaces

**Progress not saving for mentees**
→ Check `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in Vercel — make sure you used the `service_role` key, not the `anon` key

**Form responses not showing**
→ The Google Sheet must be shared as "Anyone with the link can view" — check sharing settings

---

## Your App URLs

| Page | URL |
|---|---|
| Mentor Dashboard | `your-app.vercel.app/` |
| Mentee Checklist | `your-app.vercel.app/mentee/[their-token]` |

---

## Need Help?

If you get stuck on any step, take a screenshot of the error and share it — we can troubleshoot together.
