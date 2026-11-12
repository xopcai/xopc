import { taskCheckId, verifiedTaskCheckIds } from '@xopcai/gateway-contract';

import type { ActorRef, Task, TaskCriterionReview, TaskRunReceipt } from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import { TaskRunRepository } from './task-run-repository.js';
import { taskInstructionSequence } from './task-instruction-sequence.js';
import { taskWorkspaceStillVerified, type TaskWorkspaceFile } from './task-workspace-verification.js';

type ReviewRow = {
  contract_version: number;
  check_id: string;
  criterion_index: number;
  criterion_text: string;
  status: TaskCriterionReview['status'];
  note: string | null;
  reviewed_by_json: string;
  reviewed_at: number;
};

function fromRow(row: ReviewRow): TaskCriterionReview {
  return {
    contractVersion: row.contract_version,
    checkId: row.check_id,
    criterionIndex: row.criterion_index,
    criterionText: row.criterion_text,
    status: row.status,
    ...(row.note ? { note: row.note } : {}),
    reviewedBy: JSON.parse(row.reviewed_by_json) as ActorRef,
    reviewedAt: row.reviewed_at,
  };
}

export class TaskCriterionReviewRepository {
  target(task: Pick<Task, 'id' | 'latestContractVersion'>): {
    id: string; runId?: string; receipt?: TaskRunReceipt; workspaceFiles?: TaskWorkspaceFile[];
  } | undefined {
    const runs = new TaskRunRepository();
    const run = runs.getLatestRoot(task.id);
    if (!run) return { id: 'manual' };
    if (run.status !== 'succeeded' || run.contractVersion !== task.latestContractVersion) return undefined;
    const scope = getSqliteDatabase().prepare(`SELECT result.result_id, result.assignment_epoch, result.instruction_sequence, result.workspace_files_json,
      COALESCE(state.assignment_epoch, 0) AS current_epoch
      FROM task_results result LEFT JOIN task_conversation_state state ON state.task_id = ?
      WHERE result.run_id = ? AND result.finalized_at IS NOT NULL`).get(task.id, run.id) as
      { result_id: string; assignment_epoch: number; instruction_sequence: number; workspace_files_json: string; current_epoch: number } | undefined;
    if (!scope || scope.assignment_epoch !== scope.current_epoch || scope.instruction_sequence !== taskInstructionSequence(task.id)) return undefined;
    const receipt = runs.getReceipt(run.id);
    return receipt ? { id: scope.result_id, runId: run.id, receipt,
      workspaceFiles: JSON.parse(scope.workspace_files_json) as TaskWorkspaceFile[] } : undefined;
  }

  list(taskId: string, contractVersion: number): TaskCriterionReview[] {
    const target = this.target({ id: taskId, latestContractVersion: contractVersion });
    return target ? this.listForResult(taskId, contractVersion, target.id) : [];
  }

  history(taskId: string, contractVersion: number, resultId: string | undefined): Array<TaskCriterionReview & { resultId?: string }> {
    const rows = getSqliteDatabase().prepare(`SELECT * FROM task_bound_criterion_reviews
      WHERE task_id = ? AND (? IS NULL OR contract_version <> ? OR result_id <> ?)
      ORDER BY reviewed_at DESC, contract_version DESC, result_id, criterion_index LIMIT 100`)
      .all(taskId, resultId ?? null, contractVersion, resultId ?? null) as Array<ReviewRow & { result_id: string }>;
    return rows.map(row => ({ ...fromRow(row), ...(row.result_id ? { resultId: row.result_id } : {}) }));
  }

  private listForResult(taskId: string, contractVersion: number, resultId: string): TaskCriterionReview[] {
    const rows = getSqliteDatabase().prepare(
      `SELECT * FROM task_bound_criterion_reviews WHERE task_id = ? AND contract_version = ? AND result_id = ?
       ORDER BY criterion_index`,
    ).all(taskId, contractVersion, resultId) as ReviewRow[];
    return rows.map(fromRow);
  }

  set(input: {
    task: Task;
    expectedVersion: number;
    resultId: string;
    criterionIndex: number;
    status: TaskCriterionReview['status'];
    note?: string;
    actor: ActorRef;
  }): TaskCriterionReview | undefined {
    const criterionText = input.task.contract?.acceptanceCriteria[input.criterionIndex];
    if (criterionText === undefined || input.criterionIndex < 0) return undefined;
    const reviewedAt = Date.now();
    const checkId = taskCheckId(input.task.id, input.task.latestContractVersion, input.criterionIndex);
    return runSqliteWriteTransaction((db) => {
      if (this.target(input.task)?.id !== input.resultId) return undefined;
      const updated = db.prepare(
        `UPDATE tasks SET version = version + 1, updated_at = ?
         WHERE task_id = ? AND version = ? AND latest_contract_version = ? AND phase != 'closed'`,
      ).run(reviewedAt, input.task.id, input.expectedVersion, input.task.latestContractVersion);
      if (updated.changes !== 1) return undefined;
      db.prepare(
        `INSERT INTO task_bound_criterion_reviews (
          task_id, contract_version, result_id, check_id, criterion_index, criterion_text, status, note,
          reviewed_by_json, reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id, contract_version, result_id, check_id) DO UPDATE SET
          criterion_text = excluded.criterion_text,
          status = excluded.status,
          note = excluded.note,
          reviewed_by_json = excluded.reviewed_by_json,
          reviewed_at = excluded.reviewed_at`,
      ).run(input.task.id, input.task.latestContractVersion, input.resultId, checkId, input.criterionIndex,
        criterionText, input.status, input.note?.trim() || null,
        JSON.stringify(input.actor), reviewedAt);
      return {
        contractVersion: input.task.latestContractVersion,
        checkId,
        criterionIndex: input.criterionIndex,
        criterionText,
        status: input.status,
        ...(input.note?.trim() ? { note: input.note.trim() } : {}),
        reviewedBy: input.actor,
        reviewedAt,
      };
    });
  }

  allPassed(task: Task, target = this.target(task)): boolean {
    if (!target) return false;
    const criteria = task.contract?.acceptanceCriteria ?? [];
    if (criteria.length === 0) return target.receipt?.completionVerdict === 'achieved';
    const reviews = new Map(this.listForResult(task.id, task.latestContractVersion, target.id)
      .map(review => [review.checkId, review]));
    const verified = verifiedTaskCheckIds(target.receipt);
    return criteria.every((criterion, index) => {
      const reviewed = reviews.get(taskCheckId(task.id, task.latestContractVersion, index));
      if (reviewed?.criterionText === criterion) return reviewed.status === 'passed';
      if (task.contract?.acceptancePolicy === 'manual') return false;
      return verified.has(taskCheckId(task.id, task.latestContractVersion, index));
    });
  }

  workspaceVerified(task: Task, target = this.target(task)): boolean {
    return taskWorkspaceStillVerified(task, target?.workspaceFiles ?? []);
  }

  canSignOff(task: Task, target = this.target(task)): boolean {
    if (task.phase !== 'review' || task.contract?.acceptancePolicy === 'verified_auto'
      || !target?.receipt || !target.runId || target.receipt.needsUser || !this.allPassed(task, target)
      || !this.workspaceVerified(task, target)
      || new TaskRunRepository().listActiveWaits(task.id).length > 0) return false;
    return !getSqliteDatabase().prepare(`SELECT 1 FROM task_result_deliveries delivery
      JOIN json_each(delivery.payload_json, '$.outcome.deliverables') artifact
      WHERE delivery.task_run_id = ? AND json_extract(delivery.payload_json, '$.taskResultId') = ?
        AND (delivery.status <> 'delivered'
        OR json_extract(artifact.value, '$.availability') <> 'available'
        OR (json_extract(artifact.value, '$.expiresAt') IS NOT NULL
          AND COALESCE(unixepoch(json_extract(artifact.value, '$.expiresAt')), 0) <= unixepoch('now'))) LIMIT 1`).get(target.runId, target.id);
  }
}
