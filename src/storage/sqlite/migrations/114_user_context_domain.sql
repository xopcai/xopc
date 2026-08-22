CREATE TABLE user_profiles (
  principal_id TEXT PRIMARY KEY,
  call_name TEXT NOT NULL DEFAULT '',
  pronouns TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT '',
  accessibility_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE user_understandings (
  understanding_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'preference', 'boundary', 'relationship', 'routine', 'current_state',
    'long_term_goal', 'project_context', 'task_lesson', 'derived_insight'
  )),
  canonical_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'candidate', 'active', 'needs_review', 'stale', 'archived', 'rejected'
  )),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'workspace', 'project', 'session')),
  scope_id TEXT,
  explicitness TEXT NOT NULL CHECK (explicitness IN ('explicit', 'observed', 'inferred')),
  durability TEXT NOT NULL CHECK (durability IN ('ephemeral', 'durable', 'recurring')),
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('normal', 'personal', 'secret', 'regulated')),
  disclosure_policy TEXT NOT NULL CHECK (disclosure_policy IN ('silent', 'referenceable', 'ask_before_reference')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  valid_from INTEGER,
  valid_to INTEGER,
  expires_at INTEGER,
  review_at INTEGER,
  current_version_id TEXT NOT NULL REFERENCES user_understanding_versions(version_id)
    DEFERRABLE INITIALLY DEFERRED,
  conflict_group_id TEXT,
  supersedes_id TEXT REFERENCES user_understandings(understanding_id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE user_understanding_versions (
  version_id TEXT PRIMARY KEY,
  understanding_id TEXT NOT NULL REFERENCES user_understandings(understanding_id) ON DELETE CASCADE,
  statement TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'runtime', 'connector', 'consolidation')),
  change_reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_user_understandings_principal_status
  ON user_understandings(principal_id, status, updated_at DESC);
CREATE UNIQUE INDEX idx_user_understandings_active_canonical
  ON user_understandings(principal_id, canonical_key, scope_type, COALESCE(scope_id, ''))
  WHERE status IN ('candidate', 'active', 'needs_review', 'stale');
CREATE INDEX idx_user_understandings_scope
  ON user_understandings(principal_id, scope_type, scope_id, status);
CREATE INDEX idx_user_understanding_versions_item
  ON user_understanding_versions(understanding_id, created_at DESC);

CREATE VIRTUAL TABLE user_understanding_fts USING fts5(
  statement,
  understanding_id UNINDEXED,
  version_id UNINDEXED,
  tokenize='unicode61'
);

CREATE TABLE collaboration_rules (
  rule_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('communication', 'execution', 'boundary', 'routine', 'proactive')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'archived')),
  priority INTEGER NOT NULL DEFAULT 100,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'workspace', 'project', 'session')),
  scope_id TEXT,
  conditions_json TEXT NOT NULL DEFAULT '{}',
  current_revision_id TEXT NOT NULL REFERENCES collaboration_rule_revisions(revision_id)
    DEFERRABLE INITIALLY DEFERRED,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE collaboration_rule_revisions (
  revision_id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES collaboration_rules(rule_id) ON DELETE CASCADE,
  statement TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by = 'user'),
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_collaboration_rules_principal_status
  ON collaboration_rules(principal_id, status, priority, updated_at DESC);

CREATE TABLE context_evidence (
  evidence_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('conversation', 'connector', 'user', 'runtime')),
  source_instance_id TEXT,
  source_ref TEXT NOT NULL,
  redacted_excerpt TEXT,
  trust_level TEXT NOT NULL CHECK (trust_level IN ('owner', 'trusted', 'untrusted')),
  observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_context_evidence_source
  ON context_evidence(principal_id, source_type, COALESCE(source_instance_id, ''), source_ref);

CREATE TABLE understanding_evidence_links (
  version_id TEXT NOT NULL REFERENCES user_understanding_versions(version_id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES context_evidence(evidence_id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('supports', 'contradicts', 'supersedes')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  PRIMARY KEY (version_id, evidence_id, relation)
);

CREATE TABLE context_runs (
  context_run_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  query TEXT NOT NULL,
  budget INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (turn_id)
);

CREATE TABLE context_run_items (
  context_run_id TEXT NOT NULL REFERENCES context_runs(context_run_id) ON DELETE CASCADE,
  object_type TEXT NOT NULL CHECK (object_type IN ('profile', 'rule', 'understanding')),
  object_id TEXT NOT NULL,
  version_id TEXT,
  decision TEXT NOT NULL CHECK (decision IN (
    'selected', 'irrelevant', 'expired', 'scope_mismatch', 'sensitive',
    'needs_consent', 'budget_exceeded', 'conflicted', 'disabled'
  )),
  reason TEXT NOT NULL,
  content_snapshot TEXT NOT NULL,
  source_label TEXT NOT NULL,
  rank INTEGER,
  score REAL,
  injected_chars INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (context_run_id, object_type, object_id)
);

CREATE TABLE context_feedback (
  feedback_id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  context_run_id TEXT NOT NULL REFERENCES context_runs(context_run_id) ON DELETE CASCADE,
  object_type TEXT,
  object_id TEXT,
  rating TEXT NOT NULL CHECK (rating IN ('helpful', 'irrelevant', 'wrong', 'stale', 'sensitive')),
  reason TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (turn_id, object_type, object_id)
);

CREATE UNIQUE INDEX idx_context_feedback_response
  ON context_feedback(turn_id)
  WHERE object_type IS NULL AND object_id IS NULL;

CREATE TABLE context_suppressions (
  suppression_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'workspace', 'project', 'session')),
  scope_id TEXT,
  reason TEXT NOT NULL,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_context_suppressions_identity
  ON context_suppressions(principal_id, canonical_key, scope_type, COALESCE(scope_id, ''));

CREATE TABLE context_consents (
  consent_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  understanding_id TEXT NOT NULL REFERENCES user_understandings(understanding_id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'granted', 'denied', 'consumed')),
  grant_scope TEXT CHECK (grant_scope IN ('once', 'session', 'always')),
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_context_consents_pending
  ON context_consents(understanding_id, session_key)
  WHERE status = 'pending';
