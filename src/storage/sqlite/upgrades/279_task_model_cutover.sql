-- Materialize unresolved decisions for the current root run without sending notifications.
INSERT INTO task_waits (
  wait_id, task_id, task_run_id, kind, status, reason, condition_json, created_at
)
SELECT
  'run-decision:' || run.run_id, task.task_id, run.run_id, 'external_event', 'active',
  COALESCE(NULLIF(trim(receipt.next_action), ''),
    NULLIF(trim(json_extract(receipt.failure_json, '$.recoveryAction')), ''),
    NULLIF(trim(receipt.summary), ''),
    CASE WHEN task.locale = 'zh' THEN '请核对上次执行结果' ELSE 'Check the previous run result' END),
  json_patch(json_object('type', 'run_decision', 'contractVersion', run.contract_version),
    CASE WHEN json_extract(receipt.failure_json, '$.code') IS NOT NULL
      THEN json_object('reasonCode', json_extract(receipt.failure_json, '$.code'))
      ELSE '{}' END),
  receipt.finalized_at
FROM tasks task
JOIN task_runs run ON run.run_id = (
  SELECT current.run_id FROM task_runs current
  WHERE current.task_id = task.task_id AND current.parent_run_id IS NULL
  ORDER BY current.queued_at DESC, current.rowid DESC LIMIT 1
)
JOIN task_run_receipts receipt ON receipt.run_id = run.run_id
LEFT JOIN task_conversation_state conversation ON conversation.task_id = task.task_id
WHERE task.phase <> 'closed'
  AND run.contract_version = task.latest_contract_version
  AND run.status IN ('succeeded', 'failed')
  AND receipt.needs_user = 1
  AND (run.conversation_id IS NULL OR conversation.active_conversation_id IS NULL
    OR run.conversation_id = conversation.active_conversation_id);


-- Move the editable brief into the current specification. Historical versions never had a brief.
ALTER TABLE task_contracts ADD COLUMN brief TEXT;
ALTER TABLE task_contracts ADD COLUMN result_policy TEXT NOT NULL DEFAULT 'standard'
  CHECK (result_policy IN ('standard', 'selected', 'connected'));

-- Some installed tasks were captured without a contract.
INSERT INTO task_contracts (task_id, version, objective, acceptance_policy, created_by_json, created_at)
SELECT task.task_id, task.latest_contract_version, task.title, 'manual', '{"kind":"system"}', task.created_at
FROM tasks task
WHERE NOT EXISTS (
  SELECT 1 FROM task_contracts spec WHERE spec.task_id = task.task_id AND spec.version = task.latest_contract_version
);

CREATE TEMP TABLE task_cutover_guidance (worker TEXT, connected_long TEXT, connected_short TEXT);
INSERT INTO task_cutover_guidance VALUES ('## Result for the originating conversation
For ordinary Tasks when publish_task_result is available, use it before completion to review the actual result. Connected Requests use their own structured result tool instead. When files were published, finalArtifactIds must select the exact final artifact IDs from publication receipts, including [] for a text-only result. Exclude intermediate, obsolete and failed files; publication history is not the final delivery manifest.
Provide a complete, evidence-grounded result for the originating conversation. The personal assistant may synthesize its final reply from your report. Match the user’s language and requested depth; preserve requested content, relevant sources, verified data cutoffs, uncertainty, and partial failures. Distinguish reported findings from verified facts. Do not invent a friendly opening or assume a new user request.
Keep internal planning, Agent names, tool logs, and task progress links out of the result unless the user specifically requested them or they are necessary to explain a blocker. Never substitute a progress page, a plan, or a promise for the requested result. Publish required files through the available artifact tools; do not repeat the same attachments or send the user to a Task page to collect them.', 'Before finishing, call personal_request_result with the verified summary and, for mail, message items and coverage. The host composes the final explanation and preserves structured items in the main chat.', 'Before finishing, call personal_request_result with the verified summary and, for mail, message items and coverage.');

WITH source AS MATERIALIZED (
  SELECT task.task_id, task.latest_contract_version, task.body, guidance.*,
    replace(task.body, char(13) || char(10), char(10)) AS normalized_body,
    EXISTS (SELECT 1 FROM personal_requests request WHERE request.task_id = task.task_id) AS connected,
    EXISTS (SELECT 1 FROM task_origin_links origin JOIN sessions session ON session.conversation_id = origin.conversation_id
      WHERE origin.task_id = task.task_id AND session.agent_id = 'personal-f815d4b478fa'
        AND json_extract(session.custom_data_json, '$.personalAgent') = 1) AS personal_origin
  FROM tasks task CROSS JOIN task_cutover_guidance guidance
)
UPDATE task_contracts AS spec SET
  result_policy = CASE
    WHEN source.connected THEN 'connected'
    WHEN source.personal_origin AND instr(source.normalized_body, source.worker) > 0 THEN 'selected'
    ELSE 'standard'
  END,
  brief = CASE
    WHEN spec.version <> source.latest_contract_version THEN NULL
    WHEN source.connected THEN NULLIF(trim(
      replace(replace(replace(source.normalized_body, source.worker, ''), source.connected_long, ''), source.connected_short, ''),
      char(9) || char(10) || char(13) || ' '), '')
    WHEN source.personal_origin AND instr(source.normalized_body, source.worker) > 0 THEN NULLIF(trim(
      replace(source.normalized_body, source.worker, ''), char(9) || char(10) || char(13) || ' '), '')
    ELSE source.body
  END
FROM source WHERE spec.task_id = source.task_id;

-- Revisions reuse this baseline when writing a new brief.
UPDATE task_work_revisions AS revision SET original_body = trim(
  replace(replace(revision.original_body, char(13) || char(10), char(10)), guidance.worker, ''),
  char(9) || char(10) || char(13) || ' ')
FROM task_cutover_guidance guidance
WHERE revision.original_body IS NOT NULL AND EXISTS (
  SELECT 1 FROM task_contracts spec WHERE spec.task_id = revision.task_id
    AND spec.version = revision.contract_version AND spec.result_policy = 'selected'
);
DROP TABLE task_cutover_guidance;

-- Only explicit existence criteria with an absolute destination can be converted.
WITH paths AS (
  SELECT spec.task_id, spec.version, criterion.key AS criterion_index,
    CASE WHEN instr(criterion.value, ' 存在于 /') > 0
      THEN trim(substr(criterion.value, instr(criterion.value, ' 存在于 /') + length(' 存在于 ')))
      ELSE trim(substr(criterion.value, instr(lower(criterion.value), ' exists at /') + length(' exists at '))) END AS path,
    project.project_id, rtrim(project.workspace_root, '/') AS project_root,
    session.agent_id, rtrim(agent.workspace_override, '/') AS agent_root,
    '/.xopc/workspace-' || session.agent_id || '/' AS default_workspace
  FROM task_contracts spec JOIN tasks task ON task.task_id = spec.task_id
  JOIN json_each(spec.acceptance_criteria_json) criterion
  LEFT JOIN projects project ON project.project_id = task.project_id
  LEFT JOIN task_origin_links origin ON origin.task_id = task.task_id
  LEFT JOIN sessions session ON session.conversation_id = origin.conversation_id
  LEFT JOIN agents agent ON agent.id = session.agent_id AND agent.deleted_at IS NULL
  WHERE criterion.type = 'text' AND (instr(criterion.value, ' 存在于 /') > 0 OR instr(lower(criterion.value), ' exists at /') > 0)
    AND json_array_length(spec.output_destinations_json) = 0
), matches AS (
  SELECT *,
    CASE
      WHEN project_root <> '' AND substr(path, 1, length(project_root) + 1) = project_root || '/' THEN 'project:' || project_id
      WHEN agent_root <> '' AND substr(path, 1, length(agent_root) + 1) = agent_root || '/' THEN 'agent:' || agent_id
      WHEN agent_root IS NULL AND instr(path, default_workspace) > 1 THEN 'agent:' || agent_id
    END AS workspace_id,
    CASE
      WHEN project_root <> '' AND substr(path, 1, length(project_root) + 1) = project_root || '/' THEN project_root
      WHEN agent_root <> '' AND substr(path, 1, length(agent_root) + 1) = agent_root || '/' THEN agent_root
      WHEN agent_root IS NULL AND instr(path, default_workspace) > 1
        THEN substr(path, 1, instr(path, default_workspace) + length(default_workspace) - 2)
    END AS root
  FROM paths
), destinations AS (
  SELECT task_id, version, json_group_array(json(
    CASE WHEN root IS NOT NULL THEN json_object('kind', 'workspace_file', 'workspaceId', workspace_id,
      'expectedRoot', root, 'relativePath', substr(path, length(root) + 2))
    ELSE json_object('kind', 'unresolved_workspace_file') END
  ) ORDER BY criterion_index) AS output_json
  FROM matches GROUP BY task_id, version
)
UPDATE task_contracts AS spec SET output_destinations_json = destinations.output_json
FROM destinations WHERE spec.task_id = destinations.task_id AND spec.version = destinations.version;

ALTER TABLE task_runs ADD COLUMN instruction_sequence_at_start INTEGER CHECK (instruction_sequence_at_start >= 0);

-- Equal timestamps cannot establish that the worker started after an instruction.
UPDATE task_runs AS run SET instruction_sequence_at_start = (
  SELECT COALESCE(MAX(entry.sequence), 0) FROM task_collaboration_entries entry
  WHERE entry.task_id = run.task_id AND entry.created_at < run.started_at
    AND entry.author_kind IN ('main_agent', 'user') AND entry.kind IN ('answer', 'instruction')
) WHERE run.started_at IS NOT NULL;

CREATE TABLE task_results (
  result_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES task_runs(run_id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  assignment_epoch INTEGER NOT NULL,
  instruction_sequence INTEGER NOT NULL,
  outcome_id TEXT,
  finalized_at INTEGER,
  workspace_files_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE (run_id, version),
  UNIQUE (run_id, outcome_id),
  CHECK ((outcome_id IS NULL) = (finalized_at IS NOT NULL)),
  FOREIGN KEY (run_id, outcome_id) REFERENCES task_run_outcomes(task_run_id, outcome_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_task_finalized_result ON task_results(run_id) WHERE finalized_at IS NOT NULL;

CREATE TABLE task_bound_criterion_reviews (
  task_id TEXT NOT NULL,
  contract_version INTEGER NOT NULL,
  result_id TEXT NOT NULL,
  check_id TEXT NOT NULL,
  criterion_index INTEGER NOT NULL,
  criterion_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'unverified')),
  note TEXT,
  reviewed_by_json TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, contract_version, result_id, check_id),
  FOREIGN KEY (task_id, contract_version) REFERENCES task_contracts(task_id, version) ON DELETE CASCADE
);

CREATE TABLE task_signoffs (
  signoff_id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL REFERENCES task_results(result_id) ON DELETE CASCADE,
  signed_by_json TEXT NOT NULL,
  signed_at INTEGER NOT NULL
);

-- Keep each captured output as a distinct version without making drafts signable.
WITH versions AS (
  SELECT outcome.task_run_id, outcome.outcome_id, outcome.assignment_epoch,
    COALESCE(json_extract(outcome.outcome_json, '$.research.instructionSequence'), run.instruction_sequence_at_start, 0) AS instruction_sequence,
    row_number() OVER (PARTITION BY outcome.task_run_id ORDER BY outcome.created_at, outcome.rowid) AS version
  FROM task_run_outcomes outcome JOIN task_runs run ON run.run_id = outcome.task_run_id
)
INSERT INTO task_results (result_id, run_id, version, assignment_epoch, instruction_sequence, outcome_id)
SELECT task_run_id || ':' || version, task_run_id, version, assignment_epoch, instruction_sequence, outcome_id FROM versions;

-- An existing delivery records the provenance of the finalized result.
INSERT INTO task_results (result_id, run_id, version, assignment_epoch, instruction_sequence, finalized_at)
SELECT run.run_id || ':' || (COALESCE(versions.version, 0) + 1), run.run_id, COALESCE(versions.version, 0) + 1, json_extract(delivery.payload_json, '$.assignmentEpoch'),
  json_extract(delivery.payload_json, '$.instructionSequence'), receipt.finalized_at
FROM task_runs run
LEFT JOIN (SELECT run_id, MAX(version) AS version FROM task_results GROUP BY run_id) versions ON versions.run_id = run.run_id
JOIN task_run_receipts receipt ON receipt.run_id = run.run_id
JOIN task_result_deliveries delivery ON delivery.task_run_id = run.run_id
WHERE run.parent_run_id IS NULL AND run.status = 'succeeded' AND receipt.status = 'succeeded'
  AND delivery.delivery_id = (
    SELECT first.delivery_id FROM task_result_deliveries first
    WHERE first.task_run_id = run.run_id ORDER BY first.created_at, first.rowid LIMIT 1
  )
  AND json_extract(delivery.payload_json, '$.contractVersion') = run.contract_version
  AND json_type(delivery.payload_json, '$.assignmentEpoch') = 'integer'
  AND json_type(delivery.payload_json, '$.instructionSequence') = 'integer'
  AND (
    json_extract(delivery.payload_json, '$.instructionSequence') = run.instruction_sequence_at_start
    OR (
      json_extract(delivery.payload_json, '$.outcome.research.review') = 'model_reviewed'
      AND json_extract(delivery.payload_json, '$.outcome.research.contractVersion') = run.contract_version
      AND json_extract(delivery.payload_json, '$.outcome.research.instructionSequence')
        = json_extract(delivery.payload_json, '$.instructionSequence')
      AND json_extract(delivery.payload_json, '$.text') IS json_extract(delivery.payload_json, '$.outcome.research.finalText')
      AND (json_type(delivery.payload_json, '$.outcome.research.finalText') = 'text'
        OR json_array_length(delivery.payload_json, '$.outcome.deliverables') > 0)
      AND COALESCE(json_array_length(delivery.payload_json, '$.outcome.research.finalArtifactIds'), 0)
        = json_array_length(delivery.payload_json, '$.outcome.deliverables')
      AND NOT EXISTS (
        SELECT 1 FROM json_each(delivery.payload_json, '$.outcome.deliverables') artifact
        WHERE NOT EXISTS (SELECT 1 FROM json_each(delivery.payload_json, '$.outcome.research.finalArtifactIds') selected
          WHERE selected.value = json_extract(artifact.value, '$.artifactId'))
          OR NOT EXISTS (SELECT 1 FROM json_each(delivery.payload_json, '$.outcome.research.inspectedArtifactIds') inspected
          WHERE inspected.value = json_extract(artifact.value, '$.artifactId'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM task_collaboration_entries entry
        WHERE entry.task_id = run.task_id AND entry.author_kind IN ('main_agent', 'user')
          AND entry.kind IN ('answer', 'instruction')
          AND entry.sequence <= json_extract(delivery.payload_json, '$.instructionSequence')
          AND NOT EXISTS (
            SELECT 1 FROM json_each(delivery.payload_json, '$.adoption') adoption
            WHERE json_extract(adoption.value, '$.entryId') = entry.entry_id
              AND json_extract(adoption.value, '$.sequence') = entry.sequence
              AND json_extract(adoption.value, '$.status') IN ('applied', 'superseded')
          )
      )
    )
  );

-- Preserve delivered transcript entries. Ambiguous deliveries cannot be resumed or served as current.
UPDATE task_result_deliveries AS delivery SET
  status = 'stale',
  reply_status = CASE WHEN reply_status IN ('pending', 'generating', 'ready') THEN 'stale' ELSE reply_status END,
  reply_lease_token = NULL,
  reply_lease_until = 0
WHERE delivery.status IN ('pending', 'delivered')
  AND EXISTS (
    SELECT 1 FROM task_runs run
    JOIN task_collaboration_entries entry ON entry.task_id = run.task_id
    LEFT JOIN task_results result ON result.run_id = run.run_id AND result.finalized_at IS NOT NULL
    WHERE run.run_id = delivery.task_run_id AND entry.author_kind IN ('main_agent', 'user')
      AND entry.kind IN ('answer', 'instruction')
      AND (entry.sequence > COALESCE(result.instruction_sequence, run.instruction_sequence_at_start, 0)
        OR (delivery.delivery_id NOT LIKE 'personal-request:%' AND (
          json_type(delivery.payload_json, '$.instructionSequence') IS NOT 'integer'
          OR json_extract(delivery.payload_json, '$.instructionSequence') > COALESCE(result.instruction_sequence, run.instruction_sequence_at_start, 0)
          OR entry.sequence > json_extract(delivery.payload_json, '$.instructionSequence'))))
  );

UPDATE task_result_deliveries AS delivery
SET payload_json = json_set(delivery.payload_json, '$.taskResultId', result.result_id),
    reply_payload_json = CASE WHEN delivery.reply_payload_json IS NULL THEN NULL
      ELSE json_set(delivery.reply_payload_json, '$.delivery.taskResultId', result.result_id) END
FROM task_results result
WHERE result.run_id = delivery.task_run_id AND result.finalized_at IS NOT NULL;

-- Only checks on tasks that have never executed can be mapped without an old result identity.
-- An empty result identity preserves the decision as history.
INSERT INTO task_bound_criterion_reviews
SELECT review.task_id, review.contract_version, CASE
  WHEN NOT EXISTS (SELECT 1 FROM task_runs run WHERE run.task_id = review.task_id)
    AND json_extract(spec.acceptance_criteria_json, '$[' || review.criterion_index || ']') = review.criterion_text
  THEN 'manual' ELSE '' END,
  review.task_id || ':' || review.contract_version || ':' || review.criterion_index, review.criterion_index,
  review.criterion_text, review.status, review.note, review.reviewed_by_json, review.reviewed_at
FROM task_criterion_reviews review
JOIN task_contracts spec ON spec.task_id = review.task_id AND spec.version = review.contract_version;

-- A text-only automatic check gets an identity only when it maps to one condition.
UPDATE task_run_receipts AS receipt SET verification_json = json_set(receipt.verification_json, '$.checks',
  json((SELECT json_group_array(json(
    CASE WHEN (SELECT count(*) FROM json_each(spec.acceptance_criteria_json) criterion
      WHERE criterion.value = json_extract(check_row.value, '$.criterion')) = 1
    THEN json_set(check_row.value, '$.checkId', run.task_id || ':' || run.contract_version || ':' ||
      (SELECT criterion.key FROM json_each(spec.acceptance_criteria_json) criterion
        WHERE criterion.value = json_extract(check_row.value, '$.criterion')))
    ELSE json_remove(check_row.value, '$.checkId') END
  ) ORDER BY check_row.key) FROM json_each(receipt.verification_json, '$.checks') check_row)))
FROM task_runs run JOIN task_contracts spec ON spec.task_id = run.task_id AND spec.version = run.contract_version
WHERE run.run_id = receipt.run_id;
