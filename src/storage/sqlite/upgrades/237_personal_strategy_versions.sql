CREATE TABLE personal_strategy_versions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  thread_id TEXT NOT NULL REFERENCES personal_attention_threads(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('stop', 'defer', 'adjust', 'rollback')),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  input_json TEXT NOT NULL CHECK(json_valid(input_json)),
  source_entry_id TEXT REFERENCES transcript_entries(entry_id) ON DELETE SET NULL,
  feedback_id TEXT REFERENCES personal_feedback(id) ON DELETE SET NULL,
  restored_version_id TEXT REFERENCES personal_strategy_versions(id),
  dedupe_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(owner_id, dedupe_key),
  UNIQUE(thread_id, revision)
);
CREATE INDEX personal_strategy_versions_thread ON personal_strategy_versions(thread_id, revision DESC);
