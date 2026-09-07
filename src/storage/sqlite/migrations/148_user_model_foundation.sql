CREATE TABLE user_assertion_slots (
  slot_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('user', 'person', 'goal', 'project', 'topic')),
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  cardinality TEXT NOT NULL CHECK(cardinality IN ('single', 'multiple')),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'agent', 'workspace', 'project', 'session')),
  scope_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_user_assertion_slots_identity
  ON user_assertion_slots(
    principal_id, subject_type, subject_id, predicate, scope_type, COALESCE(scope_id, '')
  );
CREATE INDEX idx_user_assertion_slots_subject
  ON user_assertion_slots(principal_id, subject_type, subject_id, predicate);
CREATE INDEX idx_user_assertion_slots_scope
  ON user_assertion_slots(principal_id, scope_type, scope_id);

CREATE TABLE user_assertions (
  assertion_id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES user_assertion_slots(slot_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN (
    'identity', 'preference', 'value', 'routine', 'capability',
    'relationship', 'current_state', 'derived_insight'
  )),
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  normalized_value TEXT NOT NULL,
  statement TEXT NOT NULL,
  authority TEXT NOT NULL CHECK(authority IN (
    'user_explicit', 'user_observed', 'system_inferred', 'external_untrusted'
  )),
  status TEXT NOT NULL CHECK(status IN (
    'candidate', 'active', 'needs_review', 'conflicted', 'stale', 'archived', 'rejected'
  )),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  declared_importance REAL CHECK(declared_importance IS NULL OR (declared_importance >= 0 AND declared_importance <= 1)),
  inferred_importance REAL NOT NULL CHECK(inferred_importance >= 0 AND inferred_importance <= 1),
  consequence TEXT NOT NULL CHECK(consequence IN ('low', 'medium', 'high', 'critical')),
  actionability REAL NOT NULL CHECK(actionability >= 0 AND actionability <= 1),
  volatility TEXT NOT NULL CHECK(volatility IN ('stable', 'slow', 'dynamic', 'event')),
  sensitivity TEXT NOT NULL CHECK(sensitivity IN ('normal', 'personal', 'secret', 'regulated')),
  disclosure_policy TEXT NOT NULL CHECK(disclosure_policy IN ('silent', 'referenceable', 'ask_before_reference')),
  applicability_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(applicability_json)),
  valid_from INTEGER,
  valid_to INTEGER,
  observed_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  review_at INTEGER,
  supersedes_assertion_id TEXT REFERENCES user_assertions(assertion_id) ON DELETE SET NULL,
  created_by TEXT NOT NULL CHECK(created_by IN ('user', 'runtime', 'connector', 'maintenance', 'migration')),
  created_at INTEGER NOT NULL,
  CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE INDEX idx_user_assertions_slot_status
  ON user_assertions(slot_id, status, valid_from, valid_to);
CREATE INDEX idx_user_assertions_review
  ON user_assertions(status, review_at) WHERE review_at IS NOT NULL;
CREATE INDEX idx_user_assertions_recorded
  ON user_assertions(recorded_at DESC);

CREATE VIRTUAL TABLE user_assertions_fts USING fts5(
  statement,
  assertion_id UNINDEXED,
  slot_id UNINDEXED,
  tokenize='unicode61'
);

CREATE TABLE user_assertion_evidence (
  assertion_id TEXT NOT NULL REFERENCES user_assertions(assertion_id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES context_evidence(evidence_id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK(relation IN ('supports', 'contradicts', 'supersedes')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(assertion_id, evidence_id, relation)
);

CREATE INDEX idx_user_assertion_evidence_source
  ON user_assertion_evidence(evidence_id, relation);

CREATE TABLE user_assertion_status_events (
  event_id TEXT PRIMARY KEY,
  assertion_id TEXT NOT NULL REFERENCES user_assertions(assertion_id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user', 'runtime', 'maintenance', 'migration')),
  reason TEXT NOT NULL,
  source_run_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_user_assertion_status_events_assertion
  ON user_assertion_status_events(assertion_id, created_at DESC);

CREATE TABLE user_goals (
  goal_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  parent_goal_id TEXT REFERENCES user_goals(goal_id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('proposed', 'active', 'paused', 'achieved', 'abandoned')),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'agent', 'workspace', 'project', 'session')),
  scope_id TEXT,
  declared_importance REAL CHECK(declared_importance IS NULL OR (declared_importance >= 0 AND declared_importance <= 1)),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  authority TEXT NOT NULL CHECK(authority IN ('user_explicit', 'user_observed', 'system_inferred', 'external_untrusted')),
  target_at INTEGER,
  valid_from INTEGER,
  valid_to INTEGER,
  review_at INTEGER,
  current_revision_id TEXT NOT NULL REFERENCES user_goal_revisions(revision_id) DEFERRABLE INITIALLY DEFERRED,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE user_goal_revisions (
  revision_id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES user_goals(goal_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  desired_outcome TEXT NOT NULL,
  success_criteria_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(success_criteria_json)),
  evidence_id TEXT REFERENCES context_evidence(evidence_id) ON DELETE SET NULL,
  created_by TEXT NOT NULL CHECK(created_by IN ('user', 'runtime', 'connector', 'maintenance', 'migration')),
  change_reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_user_goals_status
  ON user_goals(principal_id, status, updated_at DESC);
CREATE INDEX idx_user_goals_scope
  ON user_goals(principal_id, scope_type, scope_id, status);

CREATE TABLE user_priority_windows (
  priority_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('goal', 'project', 'task', 'assertion', 'topic')),
  target_id TEXT NOT NULL,
  rank TEXT NOT NULL CHECK(rank IN ('primary', 'secondary', 'background')),
  declared_importance REAL CHECK(declared_importance IS NULL OR (declared_importance >= 0 AND declared_importance <= 1)),
  urgency REAL NOT NULL CHECK(urgency >= 0 AND urgency <= 1),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'agent', 'workspace', 'project', 'session')),
  scope_id TEXT,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER NOT NULL,
  review_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'completed', 'expired')),
  evidence_id TEXT REFERENCES context_evidence(evidence_id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(valid_to >= valid_from)
);

CREATE INDEX idx_user_priority_windows_active
  ON user_priority_windows(principal_id, status, valid_from, valid_to);
CREATE INDEX idx_user_priority_windows_target
  ON user_priority_windows(target_type, target_id, status);

CREATE TABLE knowledge_items (
  knowledge_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN (
    'project_fact', 'workspace_fact', 'decision', 'task_lesson',
    'commitment', 'open_question', 'episode', 'note'
  )),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'agent', 'workspace', 'project', 'session')),
  scope_id TEXT,
  content TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('candidate', 'active', 'needs_review', 'stale', 'archived', 'rejected')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  importance REAL NOT NULL CHECK(importance >= 0 AND importance <= 1),
  valid_from INTEGER,
  valid_to INTEGER,
  expires_at INTEGER,
  review_at INTEGER,
  origin_class TEXT NOT NULL CHECK(origin_class IN ('owner', 'agent', 'system', 'untrusted')),
  source_agent_id TEXT,
  source_session_id TEXT,
  source_turn_id TEXT,
  derived_from_recalled_context INTEGER NOT NULL DEFAULT 0 CHECK(derived_from_recalled_context IN (0, 1)),
  source_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(source_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE INDEX idx_knowledge_items_status
  ON knowledge_items(principal_id, status, updated_at DESC);
CREATE INDEX idx_knowledge_items_scope
  ON knowledge_items(principal_id, scope_type, scope_id, status);
CREATE INDEX idx_knowledge_items_lifecycle
  ON knowledge_items(status, expires_at, review_at);
CREATE UNIQUE INDEX idx_knowledge_items_canonical
  ON knowledge_items(principal_id, canonical_key, scope_type, COALESCE(scope_id, ''))
  WHERE status IN ('candidate', 'active', 'needs_review', 'stale');

CREATE VIRTUAL TABLE knowledge_items_fts USING fts5(
  content,
  knowledge_id UNINDEXED,
  tokenize='unicode61'
);

CREATE TABLE memory_maintenance_runs (
  run_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK(job_type IN ('temporal_sweep', 'daily_reconciliation', 'weekly_knowledge', 'manual_repair')),
  idempotency_key TEXT NOT NULL UNIQUE,
  algorithm_version TEXT NOT NULL,
  config_snapshot_json TEXT NOT NULL CHECK(json_valid(config_snapshot_json)),
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
  cursor_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(cursor_json)),
  metrics_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metrics_json)),
  error_message TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX idx_memory_maintenance_runs_principal
  ON memory_maintenance_runs(principal_id, started_at DESC);

CREATE TABLE memory_maintenance_decisions (
  decision_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES memory_maintenance_runs(run_id) ON DELETE CASCADE,
  object_type TEXT NOT NULL CHECK(object_type IN ('assertion', 'goal', 'priority', 'knowledge', 'evidence', 'index')),
  object_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_memory_maintenance_decisions_run
  ON memory_maintenance_decisions(run_id, created_at);

CREATE TABLE execution_context_runs (
  run_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  turn_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  as_of INTEGER NOT NULL,
  budget_json TEXT NOT NULL CHECK(json_valid(budget_json)),
  metrics_json TEXT NOT NULL CHECK(json_valid(metrics_json)),
  created_at INTEGER NOT NULL
);

CREATE TABLE execution_context_items (
  run_id TEXT NOT NULL REFERENCES execution_context_runs(run_id) ON DELETE CASCADE,
  object_type TEXT NOT NULL CHECK(object_type IN ('rule', 'assertion', 'goal', 'priority', 'knowledge')),
  object_id TEXT NOT NULL,
  score REAL,
  reasons_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(reasons_json)),
  included INTEGER NOT NULL CHECK(included IN (0, 1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(run_id, object_type, object_id)
);

CREATE TABLE execution_context_feedback (
  turn_id TEXT PRIMARY KEY REFERENCES execution_context_runs(turn_id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK(rating IN ('helpful', 'irrelevant')),
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One-way data cutover. Runtime code after this migration reads only the new domains.
CREATE TEMP TABLE migrated_profile_facts (
  assertion_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  kind TEXT NOT NULL,
  statement TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO migrated_profile_facts
SELECT 'profile-call-name-' || principal_id, principal_id, 'identity.call_name', 'identity', call_name, updated_at, created_at
FROM user_profiles WHERE trim(call_name) <> ''
UNION ALL
SELECT 'profile-pronouns-' || principal_id, principal_id, 'identity.pronouns', 'identity', pronouns, updated_at, created_at
FROM user_profiles WHERE trim(pronouns) <> ''
UNION ALL
SELECT 'profile-timezone-' || principal_id, principal_id, 'preference.timezone', 'preference', timezone, updated_at, created_at
FROM user_profiles WHERE trim(timezone) <> ''
UNION ALL
SELECT 'profile-locale-' || principal_id, principal_id, 'preference.locale', 'preference', locale, updated_at, created_at
FROM user_profiles WHERE trim(locale) <> ''
UNION ALL
SELECT 'profile-role-' || principal_id, principal_id, 'identity.role', 'identity', role, updated_at, created_at
FROM user_profiles WHERE trim(role) <> '';

INSERT INTO user_assertion_slots (
  slot_id, principal_id, subject_type, subject_id, predicate, cardinality,
  scope_type, scope_id, created_at
)
SELECT 'slot-' || assertion_id, principal_id, 'user', 'self', predicate, 'single',
  'global', NULL, created_at
FROM migrated_profile_facts;

INSERT INTO user_assertions (
  assertion_id, slot_id, kind, value_json, normalized_value, statement,
  authority, status, confidence, declared_importance, inferred_importance,
  consequence, actionability, volatility, sensitivity, disclosure_policy,
  applicability_json, observed_at, recorded_at, created_by, created_at
)
SELECT assertion_id, 'slot-' || assertion_id, kind, json_quote(statement),
  lower(trim(statement)), statement, 'user_explicit', 'active', 1.0, 0.8, 0.8,
  'medium', 0.8, 'stable', 'personal', 'referenceable', '{}', observed_at,
  observed_at, 'migration', created_at
FROM migrated_profile_facts;

INSERT INTO user_assertion_slots (
  slot_id, principal_id, subject_type, subject_id, predicate, cardinality,
  scope_type, scope_id, created_at
)
SELECT
  'migrated-slot-' || u.understanding_id, u.principal_id,
  CASE WHEN u.kind = 'relationship' THEN 'person' ELSE 'user' END,
  CASE WHEN u.kind = 'relationship' THEN u.understanding_id ELSE 'self' END,
  'imported.' || u.kind || '.' || u.understanding_id,
  'single', u.scope_type, u.scope_id, u.created_at
FROM user_understandings u
WHERE u.kind NOT IN ('boundary', 'long_term_goal', 'project_context', 'task_lesson');

INSERT INTO user_assertions (
  assertion_id, slot_id, kind, value_json, normalized_value, statement,
  authority, status, confidence, declared_importance, inferred_importance,
  consequence, actionability, volatility, sensitivity, disclosure_policy,
  applicability_json, valid_from, valid_to, observed_at, recorded_at, review_at,
  supersedes_assertion_id, created_by, created_at
)
SELECT
  u.understanding_id, 'migrated-slot-' || u.understanding_id,
  CASE u.kind
    WHEN 'preference' THEN 'preference'
    WHEN 'relationship' THEN 'relationship'
    WHEN 'routine' THEN 'routine'
    WHEN 'current_state' THEN 'current_state'
    ELSE 'derived_insight'
  END,
  json_quote(v.statement), lower(trim(v.statement)), v.statement,
  CASE u.explicitness WHEN 'explicit' THEN 'user_explicit'
    WHEN 'observed' THEN 'user_observed' ELSE 'system_inferred' END,
  u.status, u.confidence, NULL,
  CASE WHEN u.explicitness = 'explicit' THEN 0.7 ELSE 0.5 END,
  'medium', 0.5,
  CASE u.kind WHEN 'current_state' THEN 'event' WHEN 'routine' THEN 'slow' ELSE 'stable' END,
  u.sensitivity, u.disclosure_policy, v.payload_json,
  u.valid_from, COALESCE(u.valid_to, u.expires_at), u.updated_at, u.updated_at,
  u.review_at,
  CASE WHEN EXISTS (
    SELECT 1 FROM user_understandings prior
    WHERE prior.understanding_id = u.supersedes_id
      AND prior.kind NOT IN ('boundary', 'long_term_goal', 'project_context', 'task_lesson')
  ) THEN u.supersedes_id ELSE NULL END,
  CASE v.created_by WHEN 'user' THEN 'user' WHEN 'connector' THEN 'connector'
    WHEN 'consolidation' THEN 'maintenance' ELSE 'runtime' END,
  u.created_at
FROM user_understandings u
JOIN user_understanding_versions v ON v.version_id = u.current_version_id
WHERE u.kind NOT IN ('boundary', 'long_term_goal', 'project_context', 'task_lesson');

INSERT INTO user_assertions_fts(statement, assertion_id, slot_id)
SELECT statement, assertion_id, slot_id FROM user_assertions;

INSERT OR IGNORE INTO user_assertion_evidence (
  assertion_id, evidence_id, relation, confidence, created_at
)
SELECT v.understanding_id, l.evidence_id, l.relation, l.confidence, e.created_at
FROM understanding_evidence_links l
JOIN user_understanding_versions v ON v.version_id = l.version_id
JOIN context_evidence e ON e.evidence_id = l.evidence_id
WHERE EXISTS (SELECT 1 FROM user_assertions a WHERE a.assertion_id = v.understanding_id);

INSERT INTO user_assertion_status_events (
  event_id, assertion_id, from_status, to_status, actor_type, reason, created_at
)
SELECT lower(hex(randomblob(16))), assertion_id, NULL, status, 'migration',
  'Imported during user-model cutover.', created_at
FROM user_assertions;

INSERT INTO collaboration_rules (
  rule_id, principal_id, category, status, priority, scope_type, scope_id,
  conditions_json, current_revision_id, created_at, updated_at
)
SELECT
  'migrated-boundary-' || u.understanding_id, u.principal_id, 'boundary',
  CASE WHEN u.status = 'active' AND u.explicitness = 'explicit' THEN 'active' ELSE 'disabled' END,
  50, u.scope_type, u.scope_id, json_object('enforcementLevel', 'planner'),
  'migrated-boundary-revision-' || u.understanding_id, u.created_at, u.updated_at
FROM user_understandings u WHERE u.kind = 'boundary';

INSERT INTO collaboration_rule_revisions (
  revision_id, rule_id, statement, created_by, created_at
)
SELECT 'migrated-boundary-revision-' || u.understanding_id,
  'migrated-boundary-' || u.understanding_id, v.statement, 'user', v.created_at
FROM user_understandings u
JOIN user_understanding_versions v ON v.version_id = u.current_version_id
WHERE u.kind = 'boundary';

INSERT INTO user_goals (
  goal_id, principal_id, status, scope_type, scope_id, declared_importance,
  confidence, authority, target_at, valid_from, valid_to, review_at,
  current_revision_id, created_at, updated_at
)
SELECT
  'understanding-goal-' || u.understanding_id, u.principal_id,
  CASE u.status WHEN 'active' THEN 'active' WHEN 'archived' THEN 'abandoned'
    WHEN 'rejected' THEN 'abandoned' ELSE 'proposed' END,
  u.scope_type, u.scope_id, CASE WHEN u.explicitness = 'explicit' THEN 0.7 ELSE NULL END,
  u.confidence,
  CASE u.explicitness WHEN 'explicit' THEN 'user_explicit'
    WHEN 'observed' THEN 'user_observed' ELSE 'system_inferred' END,
  u.valid_to, u.valid_from, u.valid_to, u.review_at,
  'understanding-goal-revision-' || u.understanding_id, u.created_at, u.updated_at
FROM user_understandings u WHERE u.kind = 'long_term_goal';

INSERT INTO user_goal_revisions (
  revision_id, goal_id, title, desired_outcome, evidence_id, created_by, change_reason, created_at
)
SELECT 'understanding-goal-revision-' || u.understanding_id,
  'understanding-goal-' || u.understanding_id, v.statement, v.statement,
  (SELECT l.evidence_id FROM understanding_evidence_links l
    WHERE l.version_id = v.version_id AND l.relation = 'supports' LIMIT 1),
  CASE WHEN u.explicitness = 'explicit' THEN 'user' ELSE 'migration' END,
  'Imported during user-model cutover.', v.created_at
FROM user_understandings u
JOIN user_understanding_versions v ON v.version_id = u.current_version_id
WHERE u.kind = 'long_term_goal';

INSERT INTO user_goals (
  goal_id, principal_id, status, scope_type, scope_id, declared_importance,
  confidence, authority, valid_from, valid_to, review_at, current_revision_id,
  created_at, updated_at
)
SELECT
  'focus-goal-' || f.focus_id, f.principal_id,
  CASE f.status WHEN 'active' THEN 'active' WHEN 'paused' THEN 'paused'
    WHEN 'completed' THEN 'achieved' WHEN 'rejected' THEN 'abandoned' ELSE 'proposed' END,
  f.scope_type, f.scope_id, CASE WHEN f.explicitness = 'explicit' THEN 0.8 ELSE NULL END,
  f.confidence,
  CASE f.explicitness WHEN 'explicit' THEN 'user_explicit'
    WHEN 'observed' THEN 'user_observed' ELSE 'system_inferred' END,
  f.valid_from, f.valid_to, f.review_at, 'focus-goal-revision-' || f.focus_id,
  f.created_at, f.updated_at
FROM user_focuses f;

INSERT INTO user_goal_revisions (
  revision_id, goal_id, title, desired_outcome, evidence_id, created_by, change_reason, created_at
)
SELECT 'focus-goal-revision-' || f.focus_id, 'focus-goal-' || f.focus_id,
  f.title, f.summary,
  (SELECT l.evidence_id FROM user_focus_evidence_links l
    WHERE l.version_id = f.current_version_id AND l.relation = 'supports' LIMIT 1),
  CASE WHEN f.explicitness = 'explicit' THEN 'user' ELSE 'migration' END,
  'Imported during user-model cutover.', f.created_at
FROM user_focuses f;

INSERT INTO user_priority_windows (
  priority_id, principal_id, target_type, target_id, rank, declared_importance,
  urgency, scope_type, scope_id, valid_from, valid_to, review_at, status,
  created_at, updated_at
)
SELECT
  'focus-priority-' || f.focus_id, f.principal_id, 'goal', 'focus-goal-' || f.focus_id,
  CASE f.horizon WHEN 'current' THEN 'primary' WHEN 'ongoing' THEN 'secondary' ELSE 'background' END,
  CASE WHEN f.explicitness = 'explicit' THEN 0.8 ELSE NULL END,
  CASE f.horizon WHEN 'current' THEN 0.9 WHEN 'ongoing' THEN 0.5 ELSE 0.2 END,
  f.scope_type, f.scope_id, COALESCE(f.valid_from, f.created_at),
  COALESCE(f.valid_to, f.review_at, f.updated_at + 2592000000),
  COALESCE(f.review_at, f.updated_at + 604800000),
  CASE f.status WHEN 'active' THEN 'active' WHEN 'completed' THEN 'completed' ELSE 'paused' END,
  f.created_at, f.updated_at
FROM user_focuses f;

INSERT OR IGNORE INTO knowledge_items (
  knowledge_id, principal_id, kind, scope_type, scope_id, content, canonical_key,
  status, confidence, importance, valid_from, valid_to, expires_at, review_at,
  origin_class, source_agent_id, source_session_id, source_turn_id,
  derived_from_recalled_context, source_json, created_at, updated_at
)
SELECT
  r.record_id, COALESCE(r.user_id, 'local-owner'),
  CASE r.kind WHEN 'workspace_fact' THEN 'workspace_fact'
    WHEN 'project_context' THEN 'project_fact' WHEN 'task_lesson' THEN 'task_lesson'
    WHEN 'decision' THEN 'decision' WHEN 'commitment' THEN 'commitment'
    WHEN 'open_question' THEN 'open_question' WHEN 'episode' THEN 'episode' ELSE 'note' END,
  CASE WHEN r.project_id IS NOT NULL THEN 'project' WHEN r.session_key IS NOT NULL THEN 'session'
    WHEN r.workspace_id IS NOT NULL THEN 'workspace' WHEN r.source_agent_id IS NOT NULL THEN 'agent'
    ELSE 'global' END,
  COALESCE(r.project_id, r.session_key, r.workspace_id, r.source_agent_id),
  r.content, COALESCE(r.canonical_key, 'record:' || r.record_id),
  CASE WHEN r.status IN ('candidate', 'active', 'stale', 'archived', 'rejected') THEN r.status
    ELSE 'needs_review' END,
  COALESCE(r.confidence, 0.5), COALESCE(r.importance, 0.5), r.valid_from, r.valid_to,
  r.expires_at, r.review_after,
  CASE WHEN r.origin_class IN ('owner', 'agent', 'system', 'untrusted') THEN r.origin_class
    WHEN r.explicitness = 'explicit' THEN 'owner' ELSE 'agent' END,
  r.source_agent_id, COALESCE(r.source_session_id, r.session_key), r.source_turn_id,
  r.derived_from_recalled_context, r.source_json, r.created_at, r.updated_at
FROM memory_records r;

INSERT OR IGNORE INTO knowledge_items (
  knowledge_id, principal_id, kind, scope_type, scope_id, content, canonical_key,
  status, confidence, importance, valid_from, valid_to, expires_at, review_at,
  origin_class, source_json, created_at, updated_at
)
SELECT
  'understanding-knowledge-' || u.understanding_id, u.principal_id,
  CASE u.kind WHEN 'project_context' THEN 'project_fact' ELSE 'task_lesson' END,
  u.scope_type, u.scope_id, v.statement, u.canonical_key,
  u.status, u.confidence, CASE WHEN u.explicitness = 'explicit' THEN 0.7 ELSE 0.5 END,
  u.valid_from, u.valid_to, u.expires_at, u.review_at,
  CASE WHEN u.explicitness = 'explicit' THEN 'owner' ELSE 'agent' END,
  v.payload_json, u.created_at, u.updated_at
FROM user_understandings u
JOIN user_understanding_versions v ON v.version_id = u.current_version_id
WHERE u.kind IN ('project_context', 'task_lesson');

INSERT INTO knowledge_items_fts(content, knowledge_id)
SELECT content, knowledge_id FROM knowledge_items;

DROP TABLE migrated_profile_facts;
DROP TABLE IF EXISTS understanding_focus_exclusions;
DROP TABLE IF EXISTS user_focus_evidence_links;
DROP TABLE IF EXISTS user_focus_versions;
DROP TABLE IF EXISTS understanding_evidence_links;
DROP TABLE IF EXISTS understanding_status_events;
DROP TABLE IF EXISTS context_temporal_assertions;
DROP TABLE IF EXISTS context_object_relations;
DROP TABLE IF EXISTS context_consolidation_decisions;
DROP TABLE IF EXISTS context_consolidation_runs;
DROP TABLE IF EXISTS user_understanding_fts;
DROP TABLE IF EXISTS user_understanding_versions;
DROP TABLE IF EXISTS user_understandings;
DROP TABLE IF EXISTS user_focuses;
DROP TABLE IF EXISTS user_profiles;
DROP TABLE IF EXISTS context_feedback;
DROP TABLE IF EXISTS context_run_items;
DROP TABLE IF EXISTS context_runs;
DROP TABLE IF EXISTS context_consents;
DROP TABLE IF EXISTS context_suppressions;
DROP TABLE IF EXISTS memory_feedback;
DROP TABLE IF EXISTS memory_trace_events;
DROP TABLE IF EXISTS memory_reference_consents;
DROP TABLE IF EXISTS memory_signals;
DROP TABLE IF EXISTS memory_evidence;
DROP TABLE IF EXISTS memory_records_fts;
DROP TABLE IF EXISTS memory_records;
DROP TABLE IF EXISTS memory_provider_state;
