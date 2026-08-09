DROP TABLE IF EXISTS proactive_insights;
DROP TABLE IF EXISTS focus_watches;
DROP TABLE IF EXISTS work_understanding_thread_feedback;
DROP TABLE IF EXISTS work_understanding_thread_evidence;
DROP TABLE IF EXISTS work_understanding_thread_projects;
DROP TABLE IF EXISTS work_understanding_threads;

CREATE TABLE focus_candidates (
  candidate_id TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'dismissed')),
  discovered_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE focus_candidate_projects (
  candidate_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (candidate_id, project_id),
  FOREIGN KEY (candidate_id) REFERENCES focus_candidates(candidate_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE TABLE focuses (
  focus_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed')),
  source TEXT NOT NULL CHECK (source IN ('user', 'discovery')),
  source_candidate_id TEXT,
  goal_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  last_activity_at INTEGER,
  FOREIGN KEY (source_candidate_id) REFERENCES focus_candidates(candidate_id) ON DELETE SET NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE SET NULL
);

CREATE TABLE focus_projects (
  focus_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (focus_id, project_id),
  FOREIGN KEY (focus_id) REFERENCES focuses(focus_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE TABLE focus_monitors (
  monitor_id TEXT PRIMARY KEY,
  focus_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('progress', 'external_changes')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  run_state TEXT NOT NULL DEFAULT 'idle' CHECK (run_state IN ('idle', 'queued', 'running', 'failed')),
  cadence_json TEXT NOT NULL,
  automation_id TEXT,
  last_run_id TEXT,
  last_run_at INTEGER,
  next_run_at INTEGER,
  last_meaningful_result_at INTEGER,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (focus_id, kind),
  FOREIGN KEY (focus_id) REFERENCES focuses(focus_id) ON DELETE CASCADE,
  FOREIGN KEY (automation_id) REFERENCES automations(automation_id) ON DELETE SET NULL
);

CREATE TABLE focus_activities (
  activity_id TEXT PRIMARY KEY,
  focus_id TEXT NOT NULL,
  monitor_id TEXT,
  type TEXT NOT NULL CHECK (type IN (
    'created', 'updated', 'paused', 'resumed', 'completed',
    'monitor_enabled', 'monitor_disabled', 'run_started', 'run_no_change',
    'run_failed', 'insight_created', 'insight_dismissed', 'insight_approved'
  )),
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (focus_id) REFERENCES focuses(focus_id) ON DELETE CASCADE,
  FOREIGN KEY (monitor_id) REFERENCES focus_monitors(monitor_id) ON DELETE SET NULL
);

CREATE TABLE focus_insights (
  insight_id TEXT PRIMARY KEY,
  focus_id TEXT NOT NULL,
  monitor_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('progress', 'external_changes')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  why_it_matters TEXT NOT NULL,
  next_action TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unread', 'dismissed', 'approved')),
  value_score REAL NOT NULL DEFAULT 0,
  value_reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (monitor_id, content_hash),
  FOREIGN KEY (focus_id) REFERENCES focuses(focus_id) ON DELETE CASCADE,
  FOREIGN KEY (monitor_id) REFERENCES focus_monitors(monitor_id) ON DELETE CASCADE
);

CREATE INDEX idx_focus_candidates_status
  ON focus_candidates(status, updated_at DESC);
CREATE INDEX idx_focuses_status_activity
  ON focuses(status, last_activity_at DESC, updated_at DESC);
CREATE UNIQUE INDEX idx_focuses_source_candidate
  ON focuses(source_candidate_id) WHERE source_candidate_id IS NOT NULL;
CREATE INDEX idx_focus_monitors_focus
  ON focus_monitors(focus_id, enabled, updated_at DESC);
CREATE INDEX idx_focus_monitors_automation
  ON focus_monitors(automation_id);
CREATE INDEX idx_focus_activities_focus
  ON focus_activities(focus_id, created_at DESC);
CREATE INDEX idx_focus_insights_focus
  ON focus_insights(focus_id, status, created_at DESC);
