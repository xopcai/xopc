import type { TaskResultVersion } from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

export function finalizedTaskResultId(runId: string): string | undefined {
  return getSqliteDatabase().prepare('SELECT result_id FROM task_results WHERE run_id = ? AND finalized_at IS NOT NULL')
    .get(runId)?.result_id as string | undefined;
}

export function recordTaskResultVersion(input: {
  runId: string;
  assignmentEpoch: number;
  instructionSequence: number;
  outcomeId?: string;
  finalizedAt?: number;
  workspaceFiles?: unknown[];
}): void {
  getSqliteDatabase().prepare(`INSERT INTO task_results
    (result_id, run_id, version, assignment_epoch, instruction_sequence, outcome_id, finalized_at, workspace_files_json)
    SELECT ? || ':' || next.version, ?, next.version, ?, ?, ?, ?, ?
    FROM (SELECT COALESCE(MAX(version), 0) + 1 AS version FROM task_results WHERE run_id = ?) next`)
    .run(input.runId, input.runId, input.assignmentEpoch, input.instructionSequence, input.outcomeId ?? null,
      input.finalizedAt ?? null, JSON.stringify(input.workspaceFiles ?? []), input.runId);
}

export function listTaskResultVersions(taskId: string): TaskResultVersion[] {
  return getSqliteDatabase().prepare(`SELECT result.result_id AS id, result.run_id AS runId, result.version,
    run.contract_version AS contractVersion, result.assignment_epoch AS assignmentEpoch,
    result.instruction_sequence AS instructionSequence, result.outcome_id AS outcomeId, result.finalized_at AS finalizedAt
    FROM task_results result JOIN task_runs run ON run.run_id = result.run_id
    WHERE run.task_id = ? ORDER BY run.queued_at DESC, run.rowid DESC, result.version DESC LIMIT 100`)
    .all(taskId).map(row => ({
      id: String(row.id), runId: String(row.runId), version: Number(row.version),
      contractVersion: Number(row.contractVersion), assignmentEpoch: Number(row.assignmentEpoch),
      instructionSequence: Number(row.instructionSequence),
      ...(row.outcomeId !== null ? { outcomeId: String(row.outcomeId) } : {}),
      ...(row.finalizedAt !== null ? { finalizedAt: Number(row.finalizedAt) } : {}),
    }));
}
