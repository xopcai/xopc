ALTER TABLE understanding_source_runs ADD COLUMN connector_learning_job_id TEXT;

UPDATE understanding_source_runs
SET connector_learning_job_id = json_extract(metadata_json, '$.connectorLearningJobId')
WHERE json_type(metadata_json, '$.connectorLearningJobId') = 'text';

CREATE TEMP TABLE duplicate_connector_source_runs AS
WITH ranked AS (
  SELECT
    run_id AS duplicate_id,
    FIRST_VALUE(run_id) OVER (
      PARTITION BY connector_learning_job_id
      ORDER BY
        CASE
          WHEN json_extract(metadata_json, '$.semanticStatus') = 'completed' THEN 0
          WHEN status = 'completed' THEN 1
          WHEN status = 'partial' THEN 2
          ELSE 3
        END,
        COALESCE(completed_at, started_at) DESC,
        rowid DESC
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY connector_learning_job_id
      ORDER BY
        CASE
          WHEN json_extract(metadata_json, '$.semanticStatus') = 'completed' THEN 0
          WHEN status = 'completed' THEN 1
          WHEN status = 'partial' THEN 2
          ELSE 3
        END,
        COALESCE(completed_at, started_at) DESC,
        rowid DESC
    ) AS rank
  FROM understanding_source_runs
  WHERE connector_learning_job_id IS NOT NULL
)
SELECT duplicate_id, keep_id FROM ranked WHERE rank > 1;

UPDATE context_evidence
SET source_run_id = (
  SELECT keep_id FROM duplicate_connector_source_runs
  WHERE duplicate_id = context_evidence.source_run_id
)
WHERE source_run_id IN (SELECT duplicate_id FROM duplicate_connector_source_runs);

DELETE FROM context_extraction_runs
WHERE source_ref IN (
  SELECT 'understanding-source-run:' || duplicate_id FROM duplicate_connector_source_runs
)
AND EXISTS (
  SELECT 1
  FROM duplicate_connector_source_runs duplicates
  JOIN context_extraction_runs kept
    ON kept.source_ref = 'understanding-source-run:' || duplicates.keep_id
    AND kept.principal_id = context_extraction_runs.principal_id
    AND kept.extractor_id = context_extraction_runs.extractor_id
    AND kept.extractor_version = context_extraction_runs.extractor_version
  WHERE context_extraction_runs.source_ref = 'understanding-source-run:' || duplicates.duplicate_id
);

UPDATE context_extraction_runs
SET source_ref = 'understanding-source-run:' || (
  SELECT keep_id FROM duplicate_connector_source_runs
  WHERE 'understanding-source-run:' || duplicate_id = context_extraction_runs.source_ref
)
WHERE source_ref IN (
  SELECT 'understanding-source-run:' || duplicate_id FROM duplicate_connector_source_runs
);

UPDATE knowledge_items
SET source_json = json_set(
  source_json,
  '$.sourceRunId',
  (
    SELECT keep_id FROM duplicate_connector_source_runs
    WHERE duplicate_id = json_extract(knowledge_items.source_json, '$.sourceRunId')
  )
)
WHERE json_extract(source_json, '$.sourceRunId') IN (
  SELECT duplicate_id FROM duplicate_connector_source_runs
);

DELETE FROM understanding_source_runs
WHERE run_id IN (SELECT duplicate_id FROM duplicate_connector_source_runs);

DROP TABLE duplicate_connector_source_runs;

CREATE UNIQUE INDEX idx_understanding_source_runs_connector_job
  ON understanding_source_runs(connector_learning_job_id)
  WHERE connector_learning_job_id IS NOT NULL;

ALTER TABLE context_extraction_outputs RENAME TO context_extraction_outputs_v200;

CREATE TABLE context_extraction_outputs (
  output_id TEXT PRIMARY KEY,
  extraction_run_id TEXT NOT NULL REFERENCES context_extraction_runs(extraction_run_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  candidate_key TEXT NOT NULL,
  object_type TEXT CHECK (object_type IN ('assertion', 'rule', 'goal', 'knowledge')),
  object_id TEXT,
  version_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('created', 'deduplicated', 'rejected')),
  created_at INTEGER NOT NULL,
  UNIQUE (extraction_run_id, ordinal)
);

INSERT INTO context_extraction_outputs (
  output_id, extraction_run_id, ordinal, candidate_key, object_type,
  object_id, version_id, outcome, created_at
)
SELECT
  output_id,
  extraction_run_id,
  ordinal,
  candidate_key,
  CASE object_type WHEN 'rule' THEN 'rule' ELSE NULL END,
  CASE object_type WHEN 'rule' THEN object_id ELSE NULL END,
  CASE object_type WHEN 'rule' THEN version_id ELSE NULL END,
  outcome,
  created_at
FROM context_extraction_outputs_v200;

DROP TABLE context_extraction_outputs_v200;

CREATE INDEX idx_context_extraction_outputs_object
  ON context_extraction_outputs(object_type, object_id);
