import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

export interface TaskOrchestrationMetrics {
  since: number;
  delegatedTasks: number;
  activeTasks: number;
  workerProgressUpdates: number;
  workerQuestions: number;
  mainInstructions: number;
  pendingDeliveries: number;
  confirmedDeliveries: number;
  interruptedRuns: number;
  repeatedRuns: number;
  pendingMainUpdates: number;
  medianFirstUpdateMs?: number;
  medianStartMs?: number;
  medianMainUpdateDeliveryMs?: number;
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : Math.round((values[middle - 1]! + values[middle]!) / 2);
}

export function getTaskOrchestrationMetrics(since = Date.now() - 7 * 24 * 60 * 60 * 1000): TaskOrchestrationMetrics {
  const db = getSqliteDatabase();
  const counts = db.prepare(`SELECT count(*) AS delegatedTasks,
    sum(CASE WHEN task.phase != 'closed' THEN 1 ELSE 0 END) AS activeTasks
    FROM task_origin_links origin JOIN tasks task ON task.task_id = origin.task_id
    WHERE origin.created_at >= ?`).get(since) as { delegatedTasks: number; activeTasks: number | null };
  const messages = db.prepare(`SELECT
    sum(CASE WHEN entry.kind = 'progress' AND entry.author_kind = 'worker_agent' THEN 1 ELSE 0 END) AS progress,
    sum(CASE WHEN entry.kind = 'question' AND entry.author_kind = 'worker_agent' THEN 1 ELSE 0 END) AS questions,
    sum(CASE WHEN entry.kind = 'instruction' AND entry.author_kind IN ('main_agent', 'user') THEN 1 ELSE 0 END) AS instructions,
    sum(CASE WHEN delivery.status = 'pending' THEN 1 ELSE 0 END) AS pending,
    sum(CASE WHEN delivery.status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed
    FROM task_collaboration_entries entry
    LEFT JOIN task_collaboration_deliveries delivery ON delivery.entry_id = entry.entry_id
    WHERE entry.created_at >= ?`).get(since) as Record<string, number | null>;
  const runs = db.prepare(`SELECT
    sum(CASE WHEN run.terminal_code = 'execution_interrupted' THEN 1 ELSE 0 END) AS interrupted,
    sum(CASE WHEN run.attempt > 1 AND run.parent_run_id IS NULL THEN 1 ELSE 0 END) AS repeated
    FROM task_runs run JOIN task_origin_links origin ON origin.task_id = run.task_id
    WHERE run.queued_at >= ?`).get(since) as Record<string, number | null>;
  const latencies = db.prepare(`SELECT origin.created_at AS createdAt,
    (SELECT min(run.started_at) FROM task_runs run WHERE run.task_id = origin.task_id) AS firstStart,
    (SELECT min(entry.created_at) FROM task_collaboration_entries entry
      WHERE entry.task_id = origin.task_id AND entry.author_kind = 'worker_agent') AS firstUpdate
    FROM task_origin_links origin WHERE origin.created_at >= ?`).all(since) as unknown as Array<{
      createdAt: number; firstStart: number | null; firstUpdate: number | null;
    }>;
  const firstUpdate = median(latencies.flatMap((row) => row.firstUpdate === null ? [] : [Math.max(0, row.firstUpdate - row.createdAt)]));
  const firstStart = median(latencies.flatMap((row) => row.firstStart === null ? [] : [Math.max(0, row.firstStart - row.createdAt)]));
  const mainUpdates = db.prepare(`SELECT main.status, main.decision, main.updated_at AS deliveredAt,
      entry.created_at AS createdAt
    FROM task_main_update_deliveries main
    JOIN task_collaboration_entries entry ON entry.entry_id = main.entry_id
    WHERE entry.created_at >= ?`).all(since) as unknown as Array<{
      status: string; decision: string | null; deliveredAt: number; createdAt: number;
    }>;
  const mainUpdateDelivery = median(mainUpdates.flatMap((row) => row.status === 'delivered' && row.decision === 'notify'
    ? [Math.max(0, row.deliveredAt - row.createdAt)] : []));
  return { since, delegatedTasks: counts.delegatedTasks, activeTasks: counts.activeTasks ?? 0,
    workerProgressUpdates: messages.progress ?? 0, workerQuestions: messages.questions ?? 0,
    mainInstructions: messages.instructions ?? 0, pendingDeliveries: messages.pending ?? 0,
    confirmedDeliveries: messages.confirmed ?? 0, interruptedRuns: runs.interrupted ?? 0,
    repeatedRuns: runs.repeated ?? 0,
    pendingMainUpdates: mainUpdates.filter((row) => row.status === 'pending').length,
    ...(firstUpdate === undefined ? {} : { medianFirstUpdateMs: firstUpdate }),
    ...(firstStart === undefined ? {} : { medianStartMs: firstStart }),
    ...(mainUpdateDelivery === undefined ? {} : { medianMainUpdateDeliveryMs: mainUpdateDelivery }),
  };
}
