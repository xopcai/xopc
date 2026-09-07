CREATE TABLE understanding_focus_exclusions (
  understanding_id TEXT NOT NULL REFERENCES user_understandings(understanding_id) ON DELETE CASCADE,
  focus_id TEXT NOT NULL REFERENCES user_focuses(focus_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (understanding_id, focus_id)
);

CREATE INDEX idx_understanding_focus_exclusions_focus
  ON understanding_focus_exclusions(focus_id);
