-- One-way conversion of persisted structured file deliveries into canonical turn outcomes.
-- This intentionally does not parse narrative text or infer paths.

CREATE TEMP TABLE turn_outcome_artifact_candidates (
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_json TEXT NOT NULL,
  PRIMARY KEY (session_id, turn_id, artifact_id)
) WITHOUT ROWID;

-- Artifacts already emitted by newer tools but missing an outcome because the run ended early.
INSERT OR IGNORE INTO turn_outcome_artifact_candidates(session_id, turn_id, artifact_id, artifact_json)
SELECT
  entry.session_id,
  json_extract(entry.payload_json, '$.turnId'),
  json_extract(artifact.value, '$.artifactId'),
  json(artifact.value)
FROM transcript_entries AS entry
JOIN json_each(entry.payload_json, '$.details.artifacts') AS artifact
WHERE json_valid(entry.payload_json)
  AND entry.role IN ('tool', 'toolResult')
  AND json_type(entry.payload_json, '$.turnId') = 'text'
  AND json_type(artifact.value, '$.artifactId') = 'text'
  AND json_type(artifact.value, '$.title') = 'text'
  AND json_type(artifact.value, '$.kind') = 'text';

-- Canonical ProductDelivery file references produced by write_file and product tools.
INSERT OR IGNORE INTO turn_outcome_artifact_candidates(session_id, turn_id, artifact_id, artifact_json)
SELECT
  entry.session_id,
  json_extract(entry.payload_json, '$.turnId'),
  json_extract(entry.payload_json, '$.details.delivery.primary.id'),
  json_patch(
    json_object(
      'artifactId', json_extract(entry.payload_json, '$.details.delivery.primary.id'),
      'title', json_extract(entry.payload_json, '$.details.delivery.primary.title'),
      'kind', CASE
        WHEN lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.xlsx'
          OR lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.xls'
          OR lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.csv'
          OR lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.tsv' THEN 'spreadsheet'
        WHEN lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.pptx'
          OR lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.ppt' THEN 'presentation'
        WHEN lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.pdf' THEN 'pdf'
        WHEN lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.docx'
          OR lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.doc'
          OR lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.md'
          OR lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.txt' THEN 'document'
        WHEN lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.png'
          OR lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.jpg'
          OR lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.jpeg'
          OR lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.gif'
          OR lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.webp' THEN 'image'
        WHEN lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.zip' THEN 'archive'
        ELSE 'file'
      END,
      'availability', CASE
        WHEN json_extract(entry.payload_json, '$.details.delivery.operation') = 'failed' THEN 'failed'
        ELSE 'available'
      END,
      'location', 'workspace',
      'capabilities', CASE
        WHEN json_extract(entry.payload_json, '$.details.delivery.operation') = 'failed'
          THEN json_array('regenerate')
        ELSE json_array('preview', 'download', 'share')
      END,
      'uri', 'xopc-file:' || json_extract(entry.payload_json, '$.details.delivery.primary.id')
    ),
    CASE
      WHEN lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.xlsx'
        THEN json_object('mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      WHEN lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.xls'
        THEN json_object('mimeType', 'application/vnd.ms-excel')
      WHEN lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.pptx'
        THEN json_object('mimeType', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      WHEN lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.docx'
        THEN json_object('mimeType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      WHEN lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.pdf'
        THEN json_object('mimeType', 'application/pdf')
      WHEN lower(json_extract(entry.payload_json, '$.details.delivery.primary.title')) GLOB '*.csv'
        THEN json_object('mimeType', 'text/csv')
      ELSE json_object()
    END
  )
FROM transcript_entries AS entry
WHERE json_valid(entry.payload_json)
  AND entry.role IN ('tool', 'toolResult')
  AND json_type(entry.payload_json, '$.turnId') = 'text'
  AND json_extract(entry.payload_json, '$.details.delivery.primary.kind') = 'file'
  AND json_type(entry.payload_json, '$.details.delivery.primary.id') = 'text'
  AND json_type(entry.payload_json, '$.details.delivery.primary.title') = 'text';

-- Persisted media from image_generate/send_media before they emitted details.artifacts.
INSERT OR IGNORE INTO turn_outcome_artifact_candidates(session_id, turn_id, artifact_id, artifact_json)
SELECT
  entry.session_id,
  json_extract(entry.payload_json, '$.turnId'),
  COALESCE(json_extract(media.value, '$.id'), json_extract(media.value, '$.uri')),
  json_patch(
    json_patch(
      json_object(
        'artifactId', COALESCE(json_extract(media.value, '$.id'), json_extract(media.value, '$.uri')),
        'title', COALESCE(json_extract(media.value, '$.name'), 'Generated file'),
        'kind', CASE
          WHEN json_extract(media.value, '$.type') IN ('photo', 'image') THEN 'image'
          WHEN json_extract(media.value, '$.type') = 'video' THEN 'video'
          WHEN json_extract(media.value, '$.type') IN ('audio', 'voice') THEN 'audio'
          WHEN lower(COALESCE(json_extract(media.value, '$.name'), '')) GLOB '*.xlsx'
            OR lower(COALESCE(json_extract(media.value, '$.name'), '')) GLOB '*.xls' THEN 'spreadsheet'
          WHEN lower(COALESCE(json_extract(media.value, '$.name'), '')) GLOB '*.pptx' THEN 'presentation'
          WHEN lower(COALESCE(json_extract(media.value, '$.name'), '')) GLOB '*.pdf' THEN 'pdf'
          ELSE 'file'
        END,
        'availability', 'available',
        'location', 'artifact_store',
        'capabilities', json_array('preview', 'download'),
        'uri', json_extract(media.value, '$.uri')
      ),
      CASE WHEN json_type(media.value, '$.mimeType') = 'text'
        THEN json_object('mimeType', json_extract(media.value, '$.mimeType')) ELSE json_object() END
    ),
    CASE WHEN json_type(media.value, '$.size') IN ('integer', 'real')
      THEN json_object('sizeBytes', json_extract(media.value, '$.size')) ELSE json_object() END
  )
FROM transcript_entries AS entry
JOIN json_each(entry.payload_json, '$.details.media') AS media
WHERE json_valid(entry.payload_json)
  AND entry.role IN ('tool', 'toolResult')
  AND json_type(entry.payload_json, '$.turnId') = 'text'
  AND json_type(media.value, '$.uri') = 'text';

-- Add missing candidates to outcomes that already exist for the turn.
UPDATE transcript_entries AS outcome
SET payload_json = json_set(
  outcome.payload_json,
  '$.data.deliverables',
  json((
    SELECT json_group_array(json(merged.artifact_json))
    FROM (
      SELECT existing.value AS artifact_json
      FROM json_each(outcome.payload_json, '$.data.deliverables') AS existing
      UNION ALL
      SELECT candidate.artifact_json
      FROM turn_outcome_artifact_candidates AS candidate
      WHERE candidate.session_id = outcome.session_id
        AND candidate.turn_id = json_extract(outcome.payload_json, '$.data.turnId')
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(outcome.payload_json, '$.data.deliverables') AS existing
          WHERE json_extract(existing.value, '$.artifactId') = candidate.artifact_id
        )
    ) AS merged
  ))
)
WHERE json_extract(outcome.payload_json, '$.customType') = 'turn_outcome'
  AND EXISTS (
    SELECT 1
    FROM turn_outcome_artifact_candidates AS candidate
    WHERE candidate.session_id = outcome.session_id
      AND candidate.turn_id = json_extract(outcome.payload_json, '$.data.turnId')
  );

CREATE TEMP TABLE turn_outcome_backfill_turns AS
WITH turn_bounds AS (
  SELECT
    entry.session_id,
    json_extract(entry.payload_json, '$.turnId') AS turn_id,
    MAX(entry.seq) AS after_seq,
    MAX(entry.created_at) AS created_at
  FROM transcript_entries AS entry
  WHERE json_valid(entry.payload_json)
    AND json_type(entry.payload_json, '$.turnId') = 'text'
  GROUP BY entry.session_id, json_extract(entry.payload_json, '$.turnId')
)
SELECT
  candidate.session_id,
  candidate.turn_id,
  bounds.after_seq,
  bounds.created_at,
  json_group_array(json(candidate.artifact_json)) AS deliverables_json
FROM turn_outcome_artifact_candidates AS candidate
JOIN turn_bounds AS bounds
  ON bounds.session_id = candidate.session_id
 AND bounds.turn_id = candidate.turn_id
WHERE NOT EXISTS (
  SELECT 1
  FROM transcript_entries AS outcome
  WHERE outcome.session_id = candidate.session_id
    AND json_extract(outcome.payload_json, '$.customType') = 'turn_outcome'
    AND json_extract(outcome.payload_json, '$.data.turnId') = candidate.turn_id
)
GROUP BY candidate.session_id, candidate.turn_id, bounds.after_seq, bounds.created_at;

-- Create one stable gap after every old row, then place each migrated outcome directly after its turn.
UPDATE transcript_entries
SET seq = -seq - 1
WHERE EXISTS (SELECT 1 FROM turn_outcome_backfill_turns);

UPDATE transcript_entries
SET seq = (-seq - 1) * 2
WHERE seq < 0
  AND EXISTS (SELECT 1 FROM turn_outcome_backfill_turns);

INSERT INTO transcript_entries(entry_id, session_id, seq, entry_kind, role, payload_json, created_at)
SELECT
  'migration:139:turn-outcome:' || turn.session_id || ':' || turn.turn_id,
  turn.session_id,
  turn.after_seq * 2 + 1,
  'message',
  NULL,
  json_object(
    'type', 'custom',
    'customType', 'turn_outcome',
    'data', json_object(
      'version', 1,
      'outcomeId', turn.turn_id || ':outcome',
      'runId', turn.turn_id,
      'turnId', turn.turn_id,
      'status', 'succeeded',
      'deliverables', json(turn.deliverables_json),
      'evidence', json_array(),
      'createdAt', strftime('%Y-%m-%dT%H:%M:%fZ', turn.created_at / 1000.0, 'unixepoch')
    ),
    'timestamp', strftime('%Y-%m-%dT%H:%M:%fZ', turn.created_at / 1000.0, 'unixepoch')
  ),
  turn.created_at + 1
FROM turn_outcome_backfill_turns AS turn;

DROP TABLE turn_outcome_backfill_turns;
DROP TABLE turn_outcome_artifact_candidates;
