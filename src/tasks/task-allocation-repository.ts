import { randomUUID } from 'node:crypto';

import type { TaskAllocation, SpecialistTaskRequirements } from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction, afterSqliteCommit } from '../storage/sqlite/transaction.js';
import { appendTranscriptEntry } from '../storage/sqlite/transcript-repository.js';
import { emitSessionTranscriptUpdate } from '../session/transcript-events.js';
import { isRoutineTaskAllocationStatus } from '../session/task-allocation-status.js';
import { resolveTaskLocale } from './task-language.js';
import { enqueueTaskChangedEvent } from './task-change-events.js';

export interface AllocationRow {
  id: string; task_id: string; origin_conversation_id: string; requirements_json: string;
  task_version: number; status: TaskAllocation['status']; selected_agent_id: string | null;
  selection_reason: string | null; reason_code: string | null; attempts: number;
  lease_token: string | null; lease_expires_at: number | null; next_attempt_at: number; updated_at: number;
}

export class TaskAllocationRepository {
  get(taskId: string): AllocationRow | undefined {
    return getSqliteDatabase().prepare('SELECT * FROM task_allocations WHERE task_id = ?').get(taskId) as unknown as AllocationRow | undefined;
  }

  summary(taskId: string): TaskAllocation | undefined {
    const row = this.get(taskId);
    return row ? { id: row.id, taskId, status: row.status, attempts: row.attempts, updatedAt: row.updated_at,
      ...(row.selected_agent_id ? { selectedAgentId: row.selected_agent_id } : {}),
      ...(row.selection_reason ? { selectionReason: row.selection_reason } : {}),
      ...(row.reason_code ? { reasonCode: row.reason_code } : {}) } : undefined;
  }

  create(taskId: string, conversationId: string, taskVersion: number, requirements: SpecialistTaskRequirements): void {
    const now = Date.now();
    getSqliteDatabase().prepare(`INSERT INTO task_allocations
      (id, task_id, origin_conversation_id, requirements_json, task_version, status, next_attempt_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`).run(randomUUID(), taskId, conversationId, JSON.stringify(requirements), taskVersion, now, now);
    const task = getSqliteDatabase().prepare('SELECT title, locale FROM tasks WHERE task_id = ?').get(taskId) as { title: string; locale?: 'zh' | 'en' };
    this.publish(taskId, resolveTaskLocale(task) === 'zh' ? '任务已提交，正在分配执行者。' : 'Task submitted; assigning an executor.');
  }

  claim(now = Date.now()): AllocationRow | undefined {
    return runSqliteWriteTransaction(db => {
      db.prepare(`UPDATE task_allocations SET status = 'cancelled', lease_token = NULL
        WHERE status IN ('pending','selecting') AND task_id IN (SELECT task_id FROM tasks WHERE phase = 'closed')`).run();
      const row = db.prepare(`SELECT a.* FROM task_allocations a JOIN tasks t ON t.task_id = a.task_id
        WHERE t.phase != 'closed' AND NOT EXISTS (SELECT 1 FROM task_waits w WHERE w.task_id = a.task_id AND w.status = 'active')
        AND ((a.status = 'pending' AND a.next_attempt_at <= ?) OR (a.status = 'selecting' AND a.lease_expires_at <= ?))
        ORDER BY a.next_attempt_at, a.id LIMIT 1`).get(now, now) as unknown as AllocationRow | undefined;
      if (!row) return undefined;
      const token = randomUUID();
      db.prepare(`UPDATE task_allocations SET status = 'selecting', lease_token = ?, lease_expires_at = ?,
        attempts = attempts + 1, updated_at = ? WHERE id = ?`).run(token, now + 60_000, now, row.id);
      return this.get(row.task_id);
    });
  }

  owns(row: AllocationRow): boolean {
    const current = this.get(row.task_id);
    return current?.status === 'selecting' && current.lease_token === row.lease_token && (current.lease_expires_at ?? 0) > Date.now();
  }

  publish(taskId: string, content: string): void {
    const row = this.get(taskId);
    if (!row) return;
    const db = getSqliteDatabase();
    const task = db.prepare('SELECT version, project_id FROM tasks WHERE task_id = ?').get(taskId) as { version: number; project_id: string | null };
    const details = { taskId, allocation: this.summary(taskId) };
    appendTranscriptEntry(row.origin_conversation_id, { role: 'custom', customType: 'task_allocation_status',
      content, display: !isRoutineTaskAllocationStatus(details), details, timestamp: Date.now() });
    enqueueTaskChangedEvent(db, { taskId, version: task.version, projectId: task.project_id ?? undefined,
      changedFields: ['delegateAgentId', 'attention'], source: 'runtime' });
    afterSqliteCommit(() => emitSessionTranscriptUpdate({ conversationId: row.origin_conversation_id }));
  }
}
