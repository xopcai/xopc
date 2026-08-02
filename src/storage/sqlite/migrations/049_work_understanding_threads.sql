CREATE TABLE IF NOT EXISTS work_understanding_threads (
  thread_id TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'blocked', 'completed', 'uncertain')),
  horizon TEXT NOT NULL CHECK (horizon IN ('current', 'ongoing', 'long_term')),
  focus_score REAL NOT NULL,
  confidence REAL NOT NULL,
  user_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (user_status IN ('unreviewed', 'confirmed', 'corrected', 'rejected')),
  parent_thread_id TEXT,
  first_observed_at INTEGER NOT NULL,
  last_observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_thread_id) REFERENCES work_understanding_threads(thread_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS work_understanding_thread_projects (
  thread_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, project_id),
  FOREIGN KEY (thread_id) REFERENCES work_understanding_threads(thread_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS work_understanding_thread_evidence (
  thread_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'supports' CHECK (relation IN ('supports', 'contradicts', 'context')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, evidence_id),
  FOREIGN KEY (thread_id) REFERENCES work_understanding_threads(thread_id) ON DELETE CASCADE,
  FOREIGN KEY (evidence_id) REFERENCES work_understanding_evidence(evidence_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS work_understanding_thread_feedback (
  feedback_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('confirmed', 'corrected', 'rejected', 'paused', 'completed')),
  corrected_title TEXT,
  corrected_summary TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES work_understanding_threads(thread_id) ON DELETE CASCADE
);

CREATE INDEX idx_work_understanding_threads_focus
  ON work_understanding_threads(user_status, status, focus_score DESC, last_observed_at DESC);

CREATE INDEX idx_work_understanding_thread_projects_project
  ON work_understanding_thread_projects(project_id, created_at DESC);
