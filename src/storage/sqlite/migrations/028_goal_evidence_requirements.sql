CREATE TABLE IF NOT EXISTS goal_evidence_requirements (
  requirement_id              TEXT PRIMARY KEY,
  goal_id                     TEXT NOT NULL,
  text                        TEXT NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'pending',
  review_reason               TEXT,
  review_confidence           REAL,
  reviewed_by                 TEXT,
  reviewed_at                 INTEGER,
  requires_human_approval     INTEGER NOT NULL DEFAULT 1,
  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL,
  sort_order                  INTEGER NOT NULL,
  UNIQUE(goal_id, text),
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_goal_evidence_requirements_goal_order
  ON goal_evidence_requirements(goal_id, sort_order ASC);

CREATE TABLE IF NOT EXISTS goal_evidence_requirement_links (
  requirement_id TEXT NOT NULL,
  evidence_id    TEXT NOT NULL,
  linked_by      TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (requirement_id, evidence_id),
  FOREIGN KEY (requirement_id) REFERENCES goal_evidence_requirements(requirement_id) ON DELETE CASCADE,
  FOREIGN KEY (evidence_id) REFERENCES goal_evidence(evidence_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_goal_evidence_requirement_links_evidence
  ON goal_evidence_requirement_links(evidence_id);

INSERT OR IGNORE INTO goal_evidence_requirements (
  requirement_id, goal_id, text, status, requires_human_approval, created_at, updated_at, sort_order
)
SELECT
  lower(hex(randomblob(16))),
  goal_contracts.goal_id,
  json_each.value,
  'pending',
  1,
  goal_contracts.created_at,
  goal_contracts.updated_at,
  CAST(json_each.key AS INTEGER) + 1
FROM goal_contracts, json_each(goal_contracts.evidence_plan_json)
WHERE json_valid(goal_contracts.evidence_plan_json) AND json_each.type = 'text';
