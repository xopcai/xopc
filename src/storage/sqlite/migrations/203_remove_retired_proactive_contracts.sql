DROP TABLE IF EXISTS relationship_settings;

CREATE TABLE context_snapshots_v203 (
  snapshot_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL UNIQUE,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('task_run', 'task', 'session')),
  owner_id TEXT NOT NULL,
  conversation_id TEXT,
  query TEXT NOT NULL,
  selected_items_json TEXT NOT NULL DEFAULT '[]',
  rejected_items_json TEXT NOT NULL DEFAULT '[]',
  consent_requests_json TEXT NOT NULL DEFAULT '[]',
  relationship_policy_json TEXT NOT NULL DEFAULT '{}',
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  allocation_json TEXT,
  authorization_snapshot_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES sessions(conversation_id) ON DELETE SET NULL
);

INSERT INTO context_snapshots_v203
SELECT * FROM context_snapshots WHERE owner_kind <> 'proactive_run';

DROP TABLE context_snapshots;
ALTER TABLE context_snapshots_v203 RENAME TO context_snapshots;

CREATE INDEX idx_context_snapshots_owner
  ON context_snapshots(owner_kind, owner_id, created_at DESC);
CREATE INDEX idx_context_snapshots_session
  ON context_snapshots(conversation_id, created_at DESC);

CREATE TABLE collaboration_rules_v203 (
  rule_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('communication', 'execution', 'boundary', 'routine', 'initiative')),
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

INSERT INTO collaboration_rules_v203 (
  rule_id, principal_id, category, status, priority, scope_type, scope_id,
  conditions_json, current_revision_id, created_at, updated_at
)
SELECT
  rule_id,
  principal_id,
  CASE category WHEN 'proactive' THEN 'initiative' ELSE category END,
  status,
  priority,
  scope_type,
  scope_id,
  conditions_json,
  current_revision_id,
  created_at,
  updated_at
FROM collaboration_rules;

DROP TABLE collaboration_rules;
ALTER TABLE collaboration_rules_v203 RENAME TO collaboration_rules;

CREATE INDEX idx_collaboration_rules_principal_status
  ON collaboration_rules(principal_id, status, priority, updated_at DESC);
