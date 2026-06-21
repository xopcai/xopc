CREATE TABLE IF NOT EXISTS goals (
  goal_id              TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  description          TEXT,
  status               TEXT NOT NULL,
  agent_id             TEXT NOT NULL,
  priority             TEXT NOT NULL DEFAULT 'normal',
  deadline_at          INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  completed_at         INTEGER,
  archived_at          INTEGER,
  active_session_key   TEXT,
  current_run_id       TEXT,
  next_action          TEXT,
  blocked_reason       TEXT,
  judge_model_ref      TEXT,
  max_turns            INTEGER NOT NULL,
  turns_used           INTEGER NOT NULL DEFAULT 0,
  ui_locale            TEXT,
  source               TEXT NOT NULL DEFAULT 'chat'
);

CREATE INDEX IF NOT EXISTS idx_goals_status_updated
  ON goals(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_goals_agent_updated
  ON goals(agent_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_goals_active_session
  ON goals(active_session_key);

CREATE TABLE IF NOT EXISTS goal_checklist_items (
  item_id            TEXT PRIMARY KEY,
  goal_id            TEXT NOT NULL,
  text               TEXT NOT NULL,
  status             TEXT NOT NULL,
  added_by           TEXT NOT NULL,
  added_at           INTEGER NOT NULL,
  completed_at       INTEGER,
  evidence_summary   TEXT,
  sort_order         INTEGER NOT NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_goal_checklist_goal_order
  ON goal_checklist_items(goal_id, sort_order);

CREATE TABLE IF NOT EXISTS goal_runs (
  run_id              TEXT PRIMARY KEY,
  goal_id             TEXT NOT NULL,
  session_key         TEXT NOT NULL,
  source              TEXT NOT NULL,
  status              TEXT NOT NULL,
  started_at          INTEGER NOT NULL,
  finished_at         INTEGER,
  verdict             TEXT,
  reason              TEXT,
  next_action         TEXT,
  assistant_preview   TEXT,
  checklist_done      INTEGER,
  checklist_total     INTEGER,
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_goal_runs_goal_started
  ON goal_runs(goal_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_goal_runs_session_started
  ON goal_runs(session_key, started_at DESC);

CREATE TABLE IF NOT EXISTS goal_events (
  event_id       TEXT PRIMARY KEY,
  goal_id        TEXT NOT NULL,
  run_id         TEXT,
  kind           TEXT NOT NULL,
  message        TEXT NOT NULL,
  data_json      TEXT,
  created_at     INTEGER NOT NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_goal_events_goal_created
  ON goal_events(goal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS goal_evidence (
  evidence_id   TEXT PRIMARY KEY,
  goal_id       TEXT NOT NULL,
  run_id        TEXT,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  summary       TEXT,
  uri           TEXT,
  data_json     TEXT,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_goal_evidence_goal_created
  ON goal_evidence(goal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS goal_session_links (
  goal_id       TEXT NOT NULL,
  session_key   TEXT NOT NULL,
  linked_at     INTEGER NOT NULL,
  PRIMARY KEY (goal_id, session_key),
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_goal_session_links_session
  ON goal_session_links(session_key, linked_at DESC);
