CREATE TABLE discussion_edits (
  discussion_id TEXT NOT NULL REFERENCES discussion_captures(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('summary', 'decisions', 'actionItems', 'risks', 'openQuestions')),
  item_id TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (discussion_id, kind, item_id)
);
