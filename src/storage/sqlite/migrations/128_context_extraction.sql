CREATE TABLE context_extraction_runs (
  extraction_run_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  extractor_id TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  processing_policy TEXT NOT NULL CHECK (processing_policy IN ('local_only', 'remote_allowed')),
  destination TEXT NOT NULL CHECK (destination IN ('deterministic', 'local_model', 'remote_model')),
  input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'skipped', 'failed')),
  error_code TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (principal_id, source_ref, extractor_id, extractor_version)
);

CREATE INDEX idx_context_extraction_runs_lookup
  ON context_extraction_runs(extractor_id, status, started_at DESC);

CREATE TABLE context_extraction_outputs (
  output_id TEXT PRIMARY KEY,
  extraction_run_id TEXT NOT NULL REFERENCES context_extraction_runs(extraction_run_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  candidate_key TEXT NOT NULL,
  object_type TEXT CHECK (object_type IN ('profile', 'rule', 'focus', 'understanding')),
  object_id TEXT,
  version_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('created', 'deduplicated', 'rejected')),
  created_at INTEGER NOT NULL,
  UNIQUE (extraction_run_id, ordinal)
);

CREATE INDEX idx_context_extraction_outputs_object
  ON context_extraction_outputs(object_type, object_id);

CREATE TABLE context_object_relations (
  relation_id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('profile', 'rule', 'focus', 'understanding')),
  subject_id TEXT NOT NULL,
  subject_version_id TEXT,
  predicate TEXT NOT NULL CHECK (predicate IN ('supersedes', 'supports', 'contradicts', 'related_to')),
  object_type TEXT NOT NULL CHECK (object_type IN ('profile', 'rule', 'focus', 'understanding')),
  object_id TEXT NOT NULL,
  object_version_id TEXT,
  factual INTEGER NOT NULL DEFAULT 1 CHECK (factual IN (0, 1)),
  extraction_run_id TEXT REFERENCES context_extraction_runs(extraction_run_id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_context_object_relations_unique
  ON context_object_relations(
    subject_type, subject_id, COALESCE(subject_version_id, ''), predicate,
    object_type, object_id, COALESCE(object_version_id, '')
  );

CREATE TABLE context_temporal_assertions (
  assertion_id TEXT PRIMARY KEY,
  object_type TEXT NOT NULL CHECK (object_type IN ('focus', 'understanding')),
  object_id TEXT NOT NULL,
  object_version_id TEXT,
  assertion_type TEXT NOT NULL CHECK (assertion_type IN ('current_state', 'routine', 'relationship', 'project_status')),
  value_json TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  valid_from INTEGER,
  valid_to INTEGER,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'active', 'closed', 'rejected')),
  extraction_run_id TEXT REFERENCES context_extraction_runs(extraction_run_id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_context_temporal_assertions_active
  ON context_temporal_assertions(object_type, object_id, assertion_type, status);
