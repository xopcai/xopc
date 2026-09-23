CREATE TABLE home_advice_generations (
  generation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'skipped', 'retry_wait', 'failed', 'cancelled')),
  reasons_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(reasons_json)),
  requested_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  retry_at INTEGER,
  lease_owner TEXT,
  lease_until INTEGER,
  lease_epoch INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 0,
  dirty_after_start INTEGER NOT NULL DEFAULT 0 CHECK(dirty_after_start IN (0, 1)),
  snapshot_hash TEXT,
  evidence_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_ids_json)),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  model_ref TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_usd REAL,
  outcome_reason TEXT,
  error_code TEXT
);

CREATE UNIQUE INDEX idx_home_advice_generation_idempotency
  ON home_advice_generations(owner_id, workspace_id, idempotency_key);
CREATE UNIQUE INDEX idx_home_advice_generation_active
  ON home_advice_generations(owner_id, workspace_id)
  WHERE status IN ('queued', 'running', 'retry_wait');
CREATE INDEX idx_home_advice_generation_claim
  ON home_advice_generations(status, retry_at, requested_at);
CREATE INDEX idx_home_advice_generation_latest
  ON home_advice_generations(owner_id, workspace_id, completed_at DESC);

CREATE TABLE home_opportunity_projections (
  opportunity_id TEXT PRIMARY KEY,
  generation_id TEXT NOT NULL REFERENCES home_advice_generations(generation_id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK(rank BETWEEN 0 AND 2),
  kind TEXT NOT NULL CHECK(kind IN ('project_next_step', 'delivery_risk', 'meeting_prep', 'commitment_follow_up', 'automation_candidate')),
  project_id TEXT,
  dedupe_key TEXT NOT NULL,
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  evidence_refs_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_refs_json)),
  snapshot_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active', 'snoozed', 'accepted', 'discussing', 'dismissed', 'expired', 'superseded')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  snoozed_until INTEGER,
  resolution_kind TEXT CHECK(resolution_kind IS NULL OR resolution_kind IN ('session', 'task', 'scene')),
  resolution_ref TEXT
);

CREATE UNIQUE INDEX idx_home_opportunity_active_dedupe
  ON home_opportunity_projections(owner_id, workspace_id, dedupe_key)
  WHERE state IN ('active', 'snoozed');
CREATE INDEX idx_home_opportunity_visible
  ON home_opportunity_projections(owner_id, workspace_id, state, rank, expires_at);

CREATE TABLE home_opportunity_feedback (
  feedback_id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES home_opportunity_projections(opportunity_id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('started', 'discussed', 'already_done', 'irrelevant', 'too_early', 'source_incorrect', 'less_like_this', 'snoozed')),
  reason_code TEXT,
  note TEXT,
  scope_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(scope_json)),
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_home_opportunity_feedback_item
  ON home_opportunity_feedback(opportunity_id, created_at DESC);
