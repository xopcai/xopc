CREATE TABLE user_entities (
  entity_id        TEXT PRIMARY KEY,
  entity_type      TEXT NOT NULL CHECK(entity_type IN ('person', 'project', 'organization')),
  canonical_label TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE user_entity_handles (
  entity_id        TEXT NOT NULL,
  handle_type      TEXT NOT NULL CHECK(handle_type IN ('email', 'provider_user', 'display_name')),
  normalized_value TEXT NOT NULL,
  source_scope     TEXT NOT NULL,
  verified         INTEGER NOT NULL CHECK(verified IN (0, 1)),
  created_at       INTEGER NOT NULL,
  PRIMARY KEY(handle_type, normalized_value, source_scope),
  FOREIGN KEY(entity_id) REFERENCES user_entities(entity_id) ON DELETE CASCADE
);

CREATE INDEX idx_user_entity_handles_entity ON user_entity_handles(entity_id);

CREATE TABLE user_claims (
  claim_id                    TEXT PRIMARY KEY,
  agent_id                    TEXT NOT NULL,
  claim_class                 TEXT NOT NULL CHECK(claim_class IN ('relationship', 'project', 'routine')),
  claim_key                   TEXT NOT NULL,
  subject_entity_id           TEXT,
  value_json                  TEXT NOT NULL,
  state                       TEXT NOT NULL CHECK(state IN ('provisional', 'active', 'rejected', 'stale')),
  user_state                  TEXT NOT NULL CHECK(user_state IN ('auto', 'confirmed', 'rejected')),
  confidence                  REAL NOT NULL,
  independent_evidence_count INTEGER NOT NULL,
  active_day_count            INTEGER NOT NULL,
  first_observed_at           INTEGER NOT NULL,
  last_reinforced_at          INTEGER NOT NULL,
  memory_record_id            TEXT,
  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL,
  UNIQUE(agent_id, claim_class, claim_key),
  FOREIGN KEY(subject_entity_id) REFERENCES user_entities(entity_id) ON DELETE SET NULL,
  FOREIGN KEY(memory_record_id) REFERENCES memory_records(record_id) ON DELETE SET NULL
);

CREATE INDEX idx_user_claims_agent_state
  ON user_claims(agent_id, state, confidence DESC, last_reinforced_at DESC);

CREATE TABLE user_claim_evidence (
  claim_id          TEXT NOT NULL,
  logical_event_key TEXT NOT NULL,
  source_item_id    TEXT NOT NULL,
  source_instance_id TEXT NOT NULL,
  relation          TEXT NOT NULL CHECK(relation IN ('supports', 'contradicts')),
  observed_at       INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  PRIMARY KEY(claim_id, logical_event_key),
  FOREIGN KEY(claim_id) REFERENCES user_claims(claim_id) ON DELETE CASCADE,
  FOREIGN KEY(source_item_id) REFERENCES knowledge_source_items(item_id) ON DELETE CASCADE
);

CREATE INDEX idx_user_claim_evidence_source ON user_claim_evidence(source_item_id);
