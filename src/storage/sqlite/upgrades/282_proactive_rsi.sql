CREATE TABLE proactive_subscriptions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'workspace', 'project', 'thread')),
  scope_id TEXT,
  source_pattern TEXT NOT NULL,
  event_type_pattern TEXT NOT NULL,
  match_predicates_json TEXT NOT NULL DEFAULT '{}',
  default_route TEXT NOT NULL CHECK (default_route IN ('drop', 'digest_only', 'triage', 'force_scout')),
  coalesce_window_ms INTEGER NOT NULL DEFAULT 180000 CHECK (coalesce_window_ms >= 0),
  authority TEXT NOT NULL CHECK (authority IN ('system_default', 'user_explicit', 'rsi_adopted')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_proactive_subscriptions_owner_enabled
  ON proactive_subscriptions(owner_id, enabled, authority);

CREATE TABLE proactive_coalesced_signals (
  owner_id TEXT NOT NULL,
  coalesce_key TEXT NOT NULL,
  subscription_id TEXT,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  subject_kind TEXT,
  subject_id TEXT,
  trust TEXT NOT NULL CHECK (trust IN ('system', 'user', 'connector', 'untrusted_webhook')),
  latest_event_id TEXT NOT NULL,
  event_ids_json TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 1 CHECK (event_count >= 1),
  payload_json TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL,
  route_hint TEXT NOT NULL CHECK (route_hint IN ('drop', 'digest_only', 'triage', 'force_scout')),
  window_started_at INTEGER NOT NULL,
  flush_after INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('buffering', 'processing', 'triaged', 'dropped')),
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, coalesce_key)
);

CREATE INDEX idx_proactive_signals_due
  ON proactive_coalesced_signals(status, flush_after, lease_until);

CREATE TABLE proactive_items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  coalesce_key TEXT NOT NULL,
  source_event_ids_json TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('tier_s_chat', 'tier_a_inbox', 'tier_b_digest', 'tier_c_silent')),
  category TEXT NOT NULL CHECK (category IN ('blocker', 'prepared_draft', 'meeting_prep', 'folder_insight', 'skill_candidate', 'pulse_digest', 'info')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  prepared_payload_json TEXT,
  proposed_action_json TEXT,
  state TEXT NOT NULL CHECK (state IN ('buffered_digest', 'ready', 'delivered', 'acted', 'snoozed', 'muted', 'stale', 'expired')),
  digest_batch_id TEXT,
  conversation_entry_id TEXT,
  human_resolution_json TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  valid_until INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_proactive_items_owner_state
  ON proactive_items(owner_id, tier, state, created_at DESC);

CREATE INDEX idx_proactive_items_coalesce
  ON proactive_items(owner_id, coalesce_key, state);

CREATE TABLE rsi_capability_candidates (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL CHECK (artifact_kind IN ('skill', 'routine_method', 'filter_rule')),
  target_id TEXT NOT NULL,
  base_version INTEGER,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('project', 'workspace', 'agent', 'global')),
  scope_id TEXT,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('recovered_failure', 'human_edit_diff', 'repeated_pattern', 'triage_mute')),
  dedupe_key TEXT NOT NULL UNIQUE,
  source_refs_json TEXT NOT NULL,
  sim_rationale_json TEXT NOT NULL,
  staged_content_uri TEXT NOT NULL,
  staged_payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  previous_content_snapshot TEXT,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('pending', 'running', 'passed', 'failed')),
  verification_report_json TEXT,
  proactive_item_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('staged', 'inbox_pending', 'adopted', 'rejected', 'rolled_back')),
  adopted_version INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_rsi_candidates_owner_status
  ON rsi_capability_candidates(owner_id, status, verification_status, created_at DESC);

CREATE TABLE rsi_capability_telemetry (
  capability_kind TEXT NOT NULL CHECK (capability_kind IN ('skill', 'routine_method', 'filter_rule')),
  target_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  invocations INTEGER NOT NULL DEFAULT 0 CHECK (invocations >= 0),
  verified_successes INTEGER NOT NULL DEFAULT 0 CHECK (verified_successes >= 0),
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  human_edits INTEGER NOT NULL DEFAULT 0 CHECK (human_edits >= 0),
  degradation_alerted INTEGER NOT NULL DEFAULT 0 CHECK (degradation_alerted IN (0, 1)),
  last_used_at INTEGER,
  PRIMARY KEY (capability_kind, target_id, version)
);
