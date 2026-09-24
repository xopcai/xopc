ALTER TABLE user_assertions ADD COLUMN domain TEXT NOT NULL DEFAULT 'identity'
  CHECK(domain IN (
    'identity', 'life_history', 'health', 'emotion', 'personality', 'cognition',
    'values', 'motivation', 'goals', 'capabilities', 'behavior', 'preferences',
    'relationships', 'resources_constraints', 'environment', 'digital_life'
  ));
ALTER TABLE user_assertions ADD COLUMN model_layer TEXT NOT NULL DEFAULT 'fact'
  CHECK(model_layer IN ('fact', 'pattern', 'interpretation'));
ALTER TABLE user_assertions ADD COLUMN sensitivity_categories_json TEXT NOT NULL DEFAULT '[]'
  CHECK(json_valid(sensitivity_categories_json));
ALTER TABLE user_assertions ADD COLUMN purpose_ids_json TEXT NOT NULL DEFAULT '["personalization"]'
  CHECK(json_valid(purpose_ids_json));
ALTER TABLE user_assertions ADD COLUMN allowed_uses_json TEXT NOT NULL DEFAULT '["answer","rank","recommend"]'
  CHECK(json_valid(allowed_uses_json));
ALTER TABLE user_assertions ADD COLUMN allowed_agent_ids_json TEXT CHECK(allowed_agent_ids_json IS NULL OR json_valid(allowed_agent_ids_json));
ALTER TABLE user_assertions ADD COLUMN consent_receipt_id TEXT;
ALTER TABLE user_assertions ADD COLUMN support_count INTEGER NOT NULL DEFAULT 0 CHECK(support_count >= 0);
ALTER TABLE user_assertions ADD COLUMN independent_source_count INTEGER NOT NULL DEFAULT 0 CHECK(independent_source_count >= 0);
ALTER TABLE user_assertions ADD COLUMN last_supported_at INTEGER;
ALTER TABLE user_assertions ADD COLUMN delete_after INTEGER;

UPDATE user_assertions SET
  domain = CASE kind
    WHEN 'identity' THEN 'identity'
    WHEN 'preference' THEN 'preferences'
    WHEN 'value' THEN 'values'
    WHEN 'routine' THEN 'behavior'
    WHEN 'capability' THEN 'capabilities'
    WHEN 'relationship' THEN 'relationships'
    WHEN 'current_state' THEN 'environment'
    ELSE 'cognition'
  END,
  model_layer = CASE
    WHEN authority = 'user_explicit' OR kind = 'current_state' THEN 'fact'
    WHEN kind = 'derived_insight' THEN 'interpretation'
    ELSE 'pattern'
  END,
  support_count = (
    SELECT COUNT(*) FROM user_assertion_evidence evidence
    WHERE evidence.assertion_id = user_assertions.assertion_id AND evidence.relation = 'supports'
  ),
  independent_source_count = (
    SELECT COUNT(DISTINCT COALESCE(context.source_instance_id, context.source_type || ':' || context.source_ref))
    FROM user_assertion_evidence evidence
    JOIN context_evidence context ON context.evidence_id = evidence.evidence_id
    WHERE evidence.assertion_id = user_assertions.assertion_id AND evidence.relation = 'supports'
  ),
  last_supported_at = (
    SELECT MAX(context.observed_at)
    FROM user_assertion_evidence evidence
    JOIN context_evidence context ON context.evidence_id = evidence.evidence_id
    WHERE evidence.assertion_id = user_assertions.assertion_id AND evidence.relation = 'supports'
  );

CREATE TABLE understanding_consent_receipts (
  receipt_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES understanding_source_grants(grant_id) ON DELETE CASCADE,
  purposes_json TEXT NOT NULL CHECK(json_valid(purposes_json)),
  allowed_domains_json TEXT NOT NULL CHECK(json_valid(allowed_domains_json)),
  denied_domains_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(denied_domains_json)),
  allowed_fields_json TEXT NOT NULL CHECK(json_valid(allowed_fields_json)),
  access_mode TEXT NOT NULL CHECK(access_mode IN ('once', 'continuous')),
  lookback_days INTEGER NOT NULL CHECK(lookback_days >= 0),
  raw_retention_days INTEGER NOT NULL CHECK(raw_retention_days >= 0),
  processing_policy TEXT NOT NULL CHECK(processing_policy IN ('local_only', 'remote_allowed')),
  allowed_agent_ids_json TEXT CHECK(allowed_agent_ids_json IS NULL OR json_valid(allowed_agent_ids_json)),
  disclosure_version TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX idx_understanding_consent_receipts_grant
  ON understanding_consent_receipts(grant_id, granted_at DESC);
CREATE UNIQUE INDEX idx_understanding_consent_receipts_active
  ON understanding_consent_receipts(grant_id) WHERE revoked_at IS NULL;

CREATE TABLE user_model_observations (
  observation_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  domain TEXT NOT NULL CHECK(domain IN (
    'identity', 'life_history', 'health', 'emotion', 'personality', 'cognition',
    'values', 'motivation', 'goals', 'capabilities', 'behavior', 'preferences',
    'relationships', 'resources_constraints', 'environment', 'digital_life'
  )),
  observation_type TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('user', 'person', 'goal', 'project', 'topic')),
  subject_id TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)),
  sensitivity_categories_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(sensitivity_categories_json)),
  owner_attribution TEXT NOT NULL CHECK(owner_attribution IN ('user', 'other', 'shared', 'unknown')),
  observed_at INTEGER NOT NULL,
  valid_to INTEGER,
  delete_after INTEGER,
  source_grant_id TEXT REFERENCES understanding_source_grants(grant_id) ON DELETE CASCADE,
  source_item_id TEXT,
  evidence_id TEXT REFERENCES context_evidence(evidence_id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(principal_id, content_hash)
);

CREATE INDEX idx_user_model_observations_domain_time
  ON user_model_observations(principal_id, domain, observed_at DESC);
CREATE INDEX idx_user_model_observations_expiry
  ON user_model_observations(delete_after) WHERE delete_after IS NOT NULL;
CREATE INDEX idx_user_model_observations_source
  ON user_model_observations(source_grant_id, source_item_id);

CREATE TABLE user_assertion_edges (
  from_assertion_id TEXT NOT NULL REFERENCES user_assertions(assertion_id) ON DELETE CASCADE,
  to_assertion_id TEXT NOT NULL REFERENCES user_assertions(assertion_id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK(relation IN ('supports', 'contradicts', 'derived_from', 'specializes')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(from_assertion_id, to_assertion_id, relation),
  CHECK(from_assertion_id <> to_assertion_id)
);

CREATE INDEX idx_user_assertion_edges_to
  ON user_assertion_edges(to_assertion_id, relation);
