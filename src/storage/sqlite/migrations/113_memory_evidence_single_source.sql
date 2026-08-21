ALTER TABLE memory_evidence ADD COLUMN session_key TEXT;
ALTER TABLE memory_evidence ADD COLUMN turn_id TEXT;
ALTER TABLE memory_evidence ADD COLUMN tool_call_id TEXT;

WITH legacy AS (
  SELECT
    r.record_id,
    json_extract(j.value, '$.sourceItemId') AS source_item_id,
    COALESCE(json_extract(j.value, '$.relation'), 'supports') AS relation,
    MAX(CAST(strftime('%s', json_extract(j.value, '$.observedAt')) AS INTEGER) * 1000) AS observed_at,
    MAX(json_extract(j.value, '$.sessionKey')) AS session_key,
    MAX(json_extract(j.value, '$.turnId')) AS turn_id,
    MAX(json_extract(j.value, '$.toolCallId')) AS tool_call_id
  FROM memory_records r, json_each(r.evidence_json) j
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

INSERT INTO memory_evidence (
  evidence_id, record_id, source_item_id, relation, excerpt, confidence,
  observed_at, session_key, turn_id, tool_call_id, created_at
)
SELECT
  lower(hex(randomblob(16))),
  r.record_id,
  json_extract(j.value, '$.sourceItemId'),
  COALESCE(json_extract(j.value, '$.relation'), 'supports'),
  json_extract(j.value, '$.sourceText'),
  json_extract(j.value, '$.confidence'),
  CAST(strftime('%s', json_extract(j.value, '$.observedAt')) AS INTEGER) * 1000,
  json_extract(j.value, '$.sessionKey'),
  json_extract(j.value, '$.turnId'),
  json_extract(j.value, '$.toolCallId'),
  r.created_at
FROM memory_records r, json_each(r.evidence_json) j
WHERE json_valid(r.evidence_json)
  AND NOT EXISTS (
    SELECT 1 FROM memory_evidence e
    WHERE e.record_id = r.record_id
      AND COALESCE(e.source_item_id, '') = COALESCE(json_extract(j.value, '$.sourceItemId'), '')
      AND e.relation = COALESCE(json_extract(j.value, '$.relation'), 'supports')
  );

ALTER TABLE memory_records DROP COLUMN evidence_json;
