CREATE TABLE user_people (
  person_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  user_display_name TEXT,
  inferred_kind TEXT NOT NULL CHECK (inferred_kind IN ('person', 'bot', 'service', 'group', 'unknown')),
  user_kind TEXT CHECK (user_kind IS NULL OR user_kind IN ('person', 'bot', 'service', 'group', 'unknown')),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  merged_into_person_id TEXT REFERENCES user_people(person_id) ON DELETE SET NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  first_observed_at INTEGER NOT NULL,
  last_observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_user_people_principal_kind
  ON user_people(principal_id, inferred_kind, last_observed_at DESC);
CREATE INDEX idx_user_people_merge_target
  ON user_people(merged_into_person_id);

CREATE TABLE user_person_handles (
  handle_id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES user_people(person_id) ON DELETE CASCADE,
  handle_type TEXT NOT NULL CHECK (handle_type IN ('email', 'provider_user', 'username', 'display_name')),
  normalized_value TEXT NOT NULL,
  display_value TEXT NOT NULL,
  source_instance_id TEXT NOT NULL,
  verification TEXT NOT NULL CHECK (verification IN ('observed', 'inferred', 'user_confirmed')),
  first_observed_at INTEGER NOT NULL,
  last_observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(handle_type, normalized_value, source_instance_id)
);

CREATE INDEX idx_user_person_handles_person ON user_person_handles(person_id);
CREATE INDEX idx_user_person_handles_lookup ON user_person_handles(handle_type, normalized_value);

CREATE TABLE user_person_source_stats (
  person_id TEXT NOT NULL REFERENCES user_people(person_id) ON DELETE CASCADE,
  source_instance_id TEXT NOT NULL,
  interaction_count INTEGER NOT NULL CHECK (interaction_count >= 0),
  first_observed_at INTEGER NOT NULL,
  last_observed_at INTEGER NOT NULL,
  last_source_item_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(person_id, source_instance_id)
);

CREATE INDEX idx_user_person_source_stats_source
  ON user_person_source_stats(source_instance_id, last_observed_at DESC);

CREATE TABLE user_people_index_state (
  principal_id TEXT PRIMARY KEY,
  source_change_sequence INTEGER NOT NULL,
  source_grants_updated_at INTEGER NOT NULL,
  rebuilt_at INTEGER NOT NULL
);
