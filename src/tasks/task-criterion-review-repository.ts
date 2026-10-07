import { verifiedTaskCriteria } from '@xopcai/gateway-contract';

import type { ActorRef, Task } from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import { TaskRunRepository } from './task-run-repository.js';

export interface TaskCriterionReview {
  contractVersion: number;
  criterionIndex: number;
  criterionText: string;
  status: 'passed' | 'failed';
  note?: string;
  reviewedBy: ActorRef;
  reviewedAt: number;
}

type ReviewRow = {
  contract_version: number;
  criterion_index: number;
  criterion_text: string;
  status: 'passed' | 'failed';
  note: string | null;
  reviewed_by_json: string;
  reviewed_at: number;
};

function fromRow(row: ReviewRow): TaskCriterionReview {
  return {
    contractVersion: row.contract_version,
    criterionIndex: row.criterion_index,
    criterionText: row.criterion_text,
    status: row.status,
    ...(row.note ? { note: row.note } : {}),
    reviewedBy: JSON.parse(row.reviewed_by_json) as ActorRef,
    reviewedAt: row.reviewed_at,
  };
}

export class TaskCriterionReviewRepository {
  list(taskId: string, contractVersion: number): TaskCriterionReview[] {
    const rows = getSqliteDatabase().prepare(
      `SELECT * FROM task_criterion_reviews WHERE task_id = ? AND contract_version = ?
       ORDER BY criterion_index`,
    ).all(taskId, contractVersion) as ReviewRow[];
    return rows.map(fromRow);
  }

  set(input: {
    task: Task;
    expectedVersion: number;
    criterionIndex: number;
    status: 'passed' | 'failed';
    note?: string;
    actor: ActorRef;
  }): TaskCriterionReview | undefined {
    const criterionText = input.task.contract?.acceptanceCriteria[input.criterionIndex];
    if (criterionText === undefined || input.criterionIndex < 0) return undefined;
    const reviewedAt = Date.now();
    return runSqliteWriteTransaction((db) => {
      const updated = db.prepare(
        `UPDATE tasks SET version = version + 1, updated_at = ?
         WHERE task_id = ? AND version = ? AND latest_contract_version = ? AND phase != 'closed'`,
      ).run(reviewedAt, input.task.id, input.expectedVersion, input.task.latestContractVersion);
      if (updated.changes !== 1) return undefined;
      db.prepare(
        `INSERT INTO task_criterion_reviews (
          task_id, contract_version, criterion_index, criterion_text, status, note,
          reviewed_by_json, reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id, contract_version, criterion_index) DO UPDATE SET
          criterion_text = excluded.criterion_text,
          status = excluded.status,
          note = excluded.note,
          reviewed_by_json = excluded.reviewed_by_json,
          reviewed_at = excluded.reviewed_at`,
      ).run(input.task.id, input.task.latestContractVersion, input.criterionIndex,
        criterionText, input.status, input.note?.trim() || null,
        JSON.stringify(input.actor), reviewedAt);
      return {
        contractVersion: input.task.latestContractVersion,
        criterionIndex: input.criterionIndex,
        criterionText,
        status: input.status,
        ...(input.note?.trim() ? { note: input.note.trim() } : {}),
        reviewedBy: input.actor,
        reviewedAt,
      };
    });
  }

  allPassed(task: Task): boolean {
    const criteria = task.contract?.acceptanceCriteria ?? [];
    if (criteria.length === 0) return false;
    const reviews = new Map(this.list(task.id, task.latestContractVersion)
      .map((review) => [review.criterionIndex, review.status]));
    const runs = new TaskRunRepository();
    const versions = new Map(runs.listByTask(task.id).map((run) => [run.id, run.contractVersion]));
    const receipts = runs.listReceipts(task.id)
      .filter((receipt) => versions.get(receipt.runId) === task.latestContractVersion)
      .sort((a, b) => b.finalizedAt - a.finalizedAt);
    return criteria.every((criterion, index) => {
      const reviewed = reviews.get(index);
      if (reviewed && task.contract?.acceptancePolicy !== 'verified_auto') return reviewed === 'passed';
      if (task.contract?.acceptancePolicy === 'manual') return false;
      for (const receipt of receipts) {
        const check = receipt.verification.checks.find((item) => item.criterion === criterion);
        if (!check || check.status === 'unverified') continue;
        return check.status === 'passed' && verifiedTaskCriteria(receipt).has(criterion);
      }
      return false;
    });
  }
}
