import type { TaskOperationalState } from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { TaskReadModelProjector } from './task-read-model-projector.js';

export interface DelegatedTaskSummary {
  id: string;
  title: string;
  phase: string;
  operationalState: TaskOperationalState;
  runStatus?: string;
  updatedAt: number;
}

export class TaskOriginRepository {
  owns(taskId: string, conversationId: string): boolean {
    return Boolean(getSqliteDatabase().prepare(`SELECT 1 FROM task_origin_links
      WHERE task_id = ? AND conversation_id = ?`).get(taskId, conversationId));
  }

  list(conversationId: string, limit = 20, options: { offset?: number; order?: 'active-first' | 'recent' } = {}): { items: DelegatedTaskSummary[]; total: number } {
    const db = getSqliteDatabase();
    const total = (db.prepare(`SELECT count(*) AS count FROM task_origin_links
      WHERE conversation_id = ?`).get(conversationId) as { count: number }).count;
    const rows = db.prepare(`SELECT task.task_id AS id, task.title, task.phase,
        MAX(task.updated_at, COALESCE((SELECT COALESCE(run.completed_at, run.started_at, run.queued_at)
          FROM task_runs run WHERE run.task_id = task.task_id AND run.parent_run_id IS NULL
          ORDER BY run.queued_at DESC LIMIT 1), task.updated_at)) AS updatedAt,
        (SELECT run.status FROM task_runs run WHERE run.task_id = task.task_id
          AND run.parent_run_id IS NULL ORDER BY run.queued_at DESC LIMIT 1) AS runStatus
      FROM task_origin_links origin JOIN tasks task ON task.task_id = origin.task_id
      WHERE origin.conversation_id = ?
      ORDER BY ${options.order === 'recent' ? '' : "CASE WHEN task.phase = 'closed' THEN 1 ELSE 0 END,"}
        updatedAt DESC, task.task_id DESC LIMIT ? OFFSET ?`).all(conversationId,
      Math.max(1, Math.min(100, Math.floor(limit))), Math.max(0, Math.floor(options.offset ?? 0))) as unknown as Array<Omit<DelegatedTaskSummary, 'operationalState' | 'runStatus'> & { runStatus: string | null }>;
    const projector = new TaskReadModelProjector();
    return { total, items: rows.map(({ runStatus, ...row }) => ({ ...row,
      operationalState: projector.get(row.id)?.operationalState ?? 'idle',
      ...(runStatus ? { runStatus } : {}) })) };
  }
}
