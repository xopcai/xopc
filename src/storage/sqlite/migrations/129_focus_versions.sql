ALTER TABLE user_focuses ADD COLUMN current_version_id TEXT;

CREATE TABLE user_focus_versions (
  version_id TEXT PRIMARY KEY,
  focus_id TEXT NOT NULL REFERENCES user_focuses(focus_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'runtime', 'connector')),
  change_reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO user_focus_versions (
  version_id, focus_id, title, summary, snapshot_json, created_by, change_reason, created_at
)
SELECT
  lower(hex(randomblob(16))), focus_id, title, summary,
  json_object(
    'horizon', horizon, 'status', status, 'confidence', confidence,
    'scopeType', scope_type, 'scopeId', scope_id, 'explicitness', explicitness,
    'sensitivity', sensitivity, 'disclosurePolicy', disclosure_policy,
    'validFrom', valid_from, 'validTo', valid_to, 'reviewAt', review_at,
    'evidenceRefs', json(evidence_refs_json)
  ),
  CASE WHEN explicitness = 'explicit' THEN 'user' ELSE 'runtime' END,
  'Migrated existing focus', created_at
FROM user_focuses;

UPDATE user_focuses
SET current_version_id = (
  SELECT version_id FROM user_focus_versions v WHERE v.focus_id = user_focuses.focus_id LIMIT 1
);

CREATE INDEX idx_user_focus_versions_focus
  ON user_focus_versions(focus_id, created_at DESC);

CREATE TABLE user_focus_evidence_links (
  version_id TEXT NOT NULL REFERENCES user_focus_versions(version_id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES context_evidence(evidence_id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('supports', 'contradicts', 'supersedes')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  PRIMARY KEY (version_id, evidence_id, relation)
);

INSERT OR IGNORE INTO user_focus_evidence_links (version_id, evidence_id, relation, confidence)
SELECT f.current_version_id, e.evidence_id, 'supports', f.confidence
FROM user_focuses f
JOIN json_each(f.evidence_refs_json) refs
JOIN context_evidence e ON e.source_ref = refs.value
WHERE f.current_version_id IS NOT NULL;
