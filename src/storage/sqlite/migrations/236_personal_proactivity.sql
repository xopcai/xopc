CREATE TABLE personal_attention_threads (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  subject TEXT NOT NULL, summary TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('outcome','discussion','interest')),
  status TEXT NOT NULL CHECK(status IN ('candidate','active','paused','completed','expired')),
  authority TEXT NOT NULL CHECK(authority IN ('user_explicit','inferred')),
  task_id TEXT, project_id TEXT, next_check_at INTEGER, pause_until INTEGER, expires_at INTEGER NOT NULL,
  last_meaningful_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX personal_attention_due ON personal_attention_threads(status, next_check_at);
CREATE TABLE personal_attention_sources (
  thread_id TEXT NOT NULL REFERENCES personal_attention_threads(id) ON DELETE CASCADE,
  evidence_id TEXT REFERENCES context_evidence(evidence_id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES transcript_entries(entry_id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
  PRIMARY KEY(thread_id, entry_id)
);
CREATE TABLE personal_wakeups (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES personal_attention_threads(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL UNIQUE, trigger_kind TEXT NOT NULL, source_event_id TEXT,
  thread_revision INTEGER NOT NULL, not_before INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','evaluating','done','cancelled','dead_letter')),
  lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX personal_wakeups_due ON personal_wakeups(status, next_attempt_at, not_before);
CREATE TABLE personal_outreach (
  id TEXT PRIMARY KEY, wakeup_id TEXT NOT NULL UNIQUE REFERENCES personal_wakeups(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES personal_attention_threads(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  origin_transcript_id TEXT NOT NULL, thread_revision INTEGER NOT NULL, context_revision INTEGER NOT NULL,
  policy_revision INTEGER NOT NULL, decision TEXT NOT NULL, reason TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('decided','ready','published','stale','cancelled')),
  text TEXT, provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),
  valid_until INTEGER NOT NULL, message_entry_id TEXT, notified_at INTEGER,
  created_at INTEGER NOT NULL, published_at INTEGER
);
CREATE INDEX personal_outreach_pending ON personal_outreach(state, created_at);
CREATE TABLE personal_feedback (
  id TEXT PRIMARY KEY, outreach_id TEXT NOT NULL REFERENCES personal_outreach(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES personal_attention_threads(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL, kind TEXT NOT NULL, scope TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at INTEGER NOT NULL,
  dedupe_key TEXT NOT NULL, UNIQUE(owner_id, dedupe_key)
);
CREATE TABLE personal_adaptive_strategies (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES personal_attention_threads(id) ON DELETE CASCADE,
  feedback_id TEXT NOT NULL UNIQUE REFERENCES personal_feedback(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK(dimension = 'preparation'), value TEXT NOT NULL,
  authority TEXT NOT NULL CHECK(authority = 'explicit'), revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL, review_at INTEGER NOT NULL
);
