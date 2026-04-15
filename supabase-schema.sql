-- ============================================
-- KW Thrive Mentorship App — Supabase Schema
-- Run this once in your Supabase SQL Editor
-- ============================================

-- Mentees table
CREATE TABLE IF NOT EXISTS mentees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monday_item_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  work_email TEXT,
  personal_email TEXT,
  mobile TEXT,
  onboard_date TEXT,
  token TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Checklist progress table
CREATE TABLE IF NOT EXISTS checklist_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentee_id UUID REFERENCES mentees(id) ON DELETE CASCADE,
  section_index INTEGER NOT NULL,
  task_index INTEGER NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mentee_id, section_index, task_index)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_checklist_mentee ON checklist_progress(mentee_id);
CREATE INDEX IF NOT EXISTS idx_mentees_token ON mentees(token);
CREATE INDEX IF NOT EXISTS idx_mentees_monday_id ON mentees(monday_item_id);

-- Enable Row Level Security
ALTER TABLE mentees ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_progress ENABLE ROW LEVEL SECURITY;

-- Policies: allow all from server (using service role key)
CREATE POLICY "Service role full access mentees"
  ON mentees FOR ALL
  USING (TRUE);

CREATE POLICY "Service role full access checklist"
  ON checklist_progress FOR ALL
  USING (TRUE);

-- Helper function to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mentees_updated_at
  BEFORE UPDATE ON mentees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER checklist_updated_at
  BEFORE UPDATE ON checklist_progress
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
