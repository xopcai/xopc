ALTER TABLE memory_evidence ADD COLUMN session_key TEXT;
ALTER TABLE memory_evidence ADD COLUMN turn_id TEXT;
ALTER TABLE memory_evidence ADD COLUMN tool_call_id TEXT;

-- Preserve evidence while treating deleted legacy sources like ON DELETE SET NULL.
WITH legacy AS (
  SELECT
    r.record_id,
    source.item_id AS source_item_id,
    COALESCE(json_extract(j.value, '$.relation'), 'supports') AS relation,
    MAX(CAST(strftime('%s', json_extract(j.value, '$.observedAt')) AS INTEGER) * 1000) AS observed_at,
    MAX(json_extract(j.value, '$.sessionKey')) AS session_key,
    MAX(json_extract(j.value, '$.turnId')) AS turn_id,
    MAX(json_extract(j.value, '$.toolCallId')) AS tool_call_id
  FROM memory_records r
  JOIN json_each(r.evidence_json) j
  LEFT JOIN knowledge_source_items source
    ON source.item_id = json_extract(j.value, '$.sourceItemId')
  WHERE json_valid(r.evidence_json)
  GROUP BY r.record_id, source_item_id, relation
)
UPDATE memory_evidence AS evidence
SET
  observed_at = COALESCE(evidence.observed_at, legacy.observed_at),
  session_key = COALESCE(evidence.session_key, legacy.session_key),
  turn_id = COALESCE(evidence.turn_id, legacy.turn_id),
  tool_call_id = COALESCE(evidence.tool_call_id, legacy.tool_call_id)
FROM legacy
WHERE evidence.record_id = legacy.record_id
  AND COALESCE(evidence.source_item_id, '') = COALESCE(legacy.source_item_id, '')
  AND evidence.relation = legacy.relation;

WITH legacy AS (
  SELECT
    r.record_id,
    source.item_id AS source_item_id,
    COALESCE(json_extract(j.value, '$.relation'), 'supports') AS relation,
    MAX(json_extract(j.value, '$.sourceText')) AS excerpt,
    MAX(json_extract(j.value, '$.confidence')) AS confidence,
    MAX(CAST(strftime('%s', json_extract(j.value, '$.observedAt')) AS INTEGER) * 1000) AS observed_at,
    MAX(json_extract(j.value, '$.sessionKey')) AS session_key,
    MAX(json_extract(j.value, '$.turnId')) AS turn_id,
    MAX(json_extract(j.value, '$.toolCallId')) AS tool_call_id,
    MAX(r.created_at) AS created_at
  FROM memory_records r
  JOIN json_each(r.evidence_json) j
  LEFT JOIN knowledge_source_items source
    ON source.item_id = json_extract(j.value, '$.sourceItemId')
  WHERE json_valid(r.evidence_json)
  GROUP BY r.record_id, source_item_id, relation
)
INSERT INTO memory_evidence (
  evidence_id, record_id, source_item_id, relation, excerpt, confidence,
  observed_at, session_key, turn_id, tool_call_id, created_at
)
SELECT
  lower(hex(randomblob(16))),
  legacy.record_id,
  legacy.source_item_id,
  legacy.relation,
  legacy.excerpt,
  legacy.confidence,
  legacy.observed_at,
  legacy.session_key,
  legacy.turn_id,
  legacy.tool_call_id,
  legacy.created_at
FROM legacy
WHERE NOT EXISTS (
  SELECT 1 FROM memory_evidence e
  WHERE e.record_id = legacy.record_id
    AND COALESCE(e.source_item_id, '') = COALESCE(legacy.source_item_id, '')
    AND e.relation = legacy.relation
);

ALTER TABLE memory_records DROP COLUMN evidence_json;
