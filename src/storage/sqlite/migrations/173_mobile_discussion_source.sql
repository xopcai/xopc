ALTER TABLE discussion_captures ADD COLUMN source_new TEXT NOT NULL DEFAULT 'web'
  CHECK (source_new IN ('web', 'electron', 'mobile'));
UPDATE discussion_captures SET source_new = source;
ALTER TABLE discussion_captures DROP COLUMN source;
ALTER TABLE discussion_captures RENAME COLUMN source_new TO source;
