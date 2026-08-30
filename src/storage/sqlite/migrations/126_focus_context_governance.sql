UPDATE understanding_source_grants
SET processing_policy = 'local_only'
WHERE adapter_id = 'local-work-folders'
   OR source_key LIKE 'understanding-source:%';

CREATE TABLE user_focuses_v126 (
  focus_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL DEFAULT 'local-owner',
  canonical_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  horizon TEXT NOT NULL CHECK (horizon IN ('current', 'ongoing', 'long_term')),
  status TEXT NOT NULL CHECK (status IN ('candidate', 'active', 'paused', 'completed', 'rejected')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'workspace', 'project', 'session')),
  scope_id TEXT,
  explicitness TEXT NOT NULL CHECK (explicitness IN ('explicit', 'observed', 'inferred')),
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('normal', 'personal', 'secret', 'regulated')),
  disclosure_policy TEXT NOT NULL CHECK (disclosure_policy IN ('silent', 'referenceable', 'ask_before_reference')),
  valid_from INTEGER,
  valid_to INTEGER,
  review_at INTEGER,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  source_run_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (source_run_id) REFERENCES understanding_source_runs(run_id) ON DELETE SET NULL,
  CHECK ((scope_type = 'global' AND scope_id IS NULL) OR (scope_type <> 'global' AND scope_id IS NOT NULL))
);

INSERT INTO user_focuses_v126 (
  focus_id, principal_id, canonical_key, title, summary, horizon, status, confidence,
  scope_type, scope_id, explicitness, sensitivity, disclosure_policy,
  evidence_refs_json, source_run_id, created_at, updated_at
)
SELECT
  focus_id, 'local-owner', canonical_key, title, summary, horizon, status, confidence,
  CASE WHEN project_id IS NULL THEN 'global' ELSE 'project' END,
  project_id,
  CASE WHEN status = 'candidate' THEN 'inferred' ELSE 'explicit' END,
  'normal', 'referenceable', evidence_refs_json, source_run_id, created_at, updated_at
FROM user_focuses;

DROP TABLE user_focuses;
ALTER TABLE user_focuses_v126 RENAME TO user_focuses;

CREATE INDEX idx_user_focuses_status
  ON user_focuses(principal_id, status, horizon, updated_at DESC);
CREATE INDEX idx_user_focuses_scope
  ON user_focuses(principal_id, scope_type, scope_id, status);

CREATE TABLE context_run_items_v126 (
  context_run_id TEXT NOT NULL REFERENCES context_runs(context_run_id) ON DELETE CASCADE,
  object_type TEXT NOT NULL CHECK (object_type IN ('profile', 'rule', 'focus', 'understanding')),
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

INSERT INTO context_run_items_v126 SELECT * FROM context_run_items;
DROP TABLE context_run_items;
ALTER TABLE context_run_items_v126 RENAME TO context_run_items;
