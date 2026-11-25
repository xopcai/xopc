import type { TaskWait, TaskWaitKind } from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

type TaskWaitRow = {
  wait_id: string;
  task_id: string;
  task_run_id: string | null;
  kind: TaskWaitKind;
  status: TaskWait['status'];
  reason: string;
  condition_json: string;
  resume_at: number | null;
  resolved_by_json: string | null;
  resolution_json: string | null;
  created_at: number;
  resolved_at: number | null;
};

function waitFromRow(row: TaskWaitRow): TaskWait {
  return {
    id: row.wait_id,
    taskId: row.task_id,
    ...(row.task_run_id ? { taskRunId: row.task_run_id } : {}),
    kind: row.kind,
    status: row.status,
    reason: row.reason,
    condition: JSON.parse(row.condition_json) as TaskWait['condition'],
    ...(row.resume_at === null ? {} : { resumeAt: row.resume_at }),
    ...(row.resolved_by_json ? { resolvedBy: JSON.parse(row.resolved_by_json) as TaskWait['resolvedBy'] } : {}),
    ...(row.resolution_json ? { resolution: JSON.parse(row.resolution_json) as unknown } : {}),
    createdAt: row.created_at,
    ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at }),
  };
}

export function getTaskWait(waitId: string): TaskWait | undefined {
  const row = getSqliteDatabase().prepare(
    'SELECT * FROM task_waits WHERE wait_id = ?',
  ).get(waitId) as TaskWaitRow | undefined;
  return row ? waitFromRow(row) : undefined;
}

export function listActiveTaskWaits(taskId: string): TaskWait[] {
  return (getSqliteDatabase().prepare(
    `SELECT * FROM task_waits WHERE task_id = ? AND status = 'active'
     ORDER BY created_at ASC`,
  ).all(taskId) as TaskWaitRow[]).map(waitFromRow);
}
