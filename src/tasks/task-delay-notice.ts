import { personalAgentId } from '../personal-agent/repository.js';
import { runSqliteWriteTransaction, getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { TaskCollaborationRepository, type TaskCollaborationEntry } from './task-collaboration-repository.js';
import { getTaskNotificationPreference } from './task-notification-preference.js';

const QUEUE_DELAY_MS = 5 * 60_000;
const EXECUTION_INACTIVITY_MS = 20 * 60_000;
const AUTHOR = 'task-delay-monitor';

const eligibleTasks = `WITH active AS (
  SELECT t.task_id, t.due_at, t.locale, o.conversation_id,
    max(o.created_at, coalesce((SELECT max(revision.created_at) FROM task_work_revisions revision
      WHERE revision.task_id = t.task_id), o.created_at)) AS created_at,
    r.run_id, r.status,
    CASE WHEN r.status = 'queued' THEN max(r.queued_at, coalesce(r.scheduled_at, r.queued_at))
      ELSE coalesce(r.started_at, r.queued_at) END AS run_since,
    max(
      coalesce((SELECT max(e.created_at) FROM task_collaboration_entries e
        WHERE e.task_id = t.task_id AND e.created_at >= r.queued_at
          AND ((e.task_run_id = r.run_id AND e.author_kind = 'worker_agent' AND e.kind = 'progress')
            OR (e.author_kind IN ('user','main_agent') AND e.kind IN ('instruction','answer')))), 0),
      coalesce((SELECT max(w.resolved_at) FROM task_waits w
        WHERE w.task_id = t.task_id AND w.task_run_id = r.run_id AND w.status = 'resolved'), 0)
    ) AS progress_at
  FROM task_origin_links o JOIN tasks t ON t.task_id = o.task_id
  JOIN sessions s ON s.conversation_id = o.conversation_id AND s.active_transcript_id = o.origin_transcript_id
  LEFT JOIN task_allocations a ON a.task_id = t.task_id
  LEFT JOIN task_runs r ON r.run_id = (
    SELECT candidate.run_id FROM task_runs candidate WHERE candidate.task_id = t.task_id AND candidate.parent_run_id IS NULL
      AND candidate.contract_version = t.latest_contract_version
    ORDER BY candidate.queued_at DESC, candidate.rowid DESC LIMIT 1)
  WHERE s.agent_id = ? AND json_extract(s.custom_data_json, '$.personalAgent') = 1 AND t.phase != 'closed'
    AND NOT EXISTS (SELECT 1 FROM task_waits w WHERE w.task_id = t.task_id AND w.status = 'active')
    AND ((r.run_id IS NULL AND a.status IN ('pending','selecting')) OR r.status IN ('queued','running','verifying'))
), delays AS (
  SELECT *, CASE WHEN due_at <= @now AND (status IS NOT 'queued' OR run_since <= @now) THEN 'overdue'
    WHEN status IS NULL AND created_at <= @queueCutoff THEN 'allocation'
    WHEN status = 'queued' AND run_since <= @queueCutoff THEN 'queue'
    WHEN status IN ('running','verifying') AND max(run_since, coalesce(progress_at, run_since)) <= @executionCutoff THEN 'execution'
    END AS reason FROM active
)`;

type Delay = { task_id: string; conversation_id: string; run_id: string | null; locale: string | null;
  reason: 'overdue' | 'allocation' | 'queue' | 'execution'; created_at: number; run_since: number | null; progress_at: number | null };
function delayParameters(now: number) {
  return { now, queueCutoff: now - QUEUE_DELAY_MS, executionCutoff: now - EXECUTION_INACTIVITY_MS };
}

const messages = {
  overdue: { zh: '已过任务截止时间，结果还没有交付。', en: 'The task deadline has passed and the result is still pending.' },
  allocation: { zh: '任务提交超过五分钟，仍在等待分配执行者。', en: 'The task has been waiting for an executor for over five minutes.' },
  queue: { zh: '任务已在执行队列中等待超过五分钟。', en: 'The task has been in the execution queue for over five minutes.' },
  execution: { zh: '任务已超过二十分钟没有新的进度记录。', en: 'The task has had no new progress recorded for over twenty minutes.' },
};

function delayKey(row: Delay): string {
  return `task-delay:${row.reason}:${row.run_id ?? 'allocation'}:${row.progress_at || row.run_since || row.created_at}`;
}

export function enqueueTaskDelayNotices(now = Date.now()): number {
  return runSqliteWriteTransaction(db => {
    const rows = db.prepare(`${eligibleTasks} SELECT * FROM delays d WHERE reason IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM task_collaboration_entries e JOIN task_main_update_deliveries m ON m.entry_id = e.entry_id
        WHERE e.task_id = d.task_id AND e.author_kind = 'system' AND e.author_id = @author
          AND (m.status = 'pending' OR m.decision = 'notify'
            OR e.idempotency_key = 'task-delay:' || d.reason || ':' || coalesce(d.run_id,'allocation')
              || ':' || coalesce(nullif(d.progress_at,0),d.run_since,d.created_at)))
      AND coalesce(
        (SELECT json_extract(edge.metadata_json, '$.preference') FROM context_edges edge
          WHERE edge.owner_kind = 'task' AND edge.owner_id = d.task_id AND edge.target_kind = 'source'
            AND edge.target_id = 'task-notifications:' || d.conversation_id AND edge.role = 'reference'
            AND json_extract(edge.metadata_json, '$.kind') = 'task_notification_preference'),
        (SELECT json_extract(request.parameters_json, '$.notificationPreference') FROM personal_requests request
          WHERE request.task_id = d.task_id),
        'default') != 'final_only'
      ORDER BY d.due_at IS NULL, d.due_at, d.created_at LIMIT 20`)
      .all({ ...delayParameters(now), author: AUTHOR }, personalAgentId('local-owner')) as unknown as Delay[];
    const board = new TaskCollaborationRepository();
    for (const row of rows) {
      board.append({ taskId: row.task_id, taskRunId: row.run_id ?? undefined, authorKind: 'system',
        authorId: AUTHOR, kind: 'progress', body: messages[row.reason][row.locale === 'zh' ? 'zh' : 'en'], idempotencyKey: delayKey(row) });
    }
    return rows.length;
  });
}

export function isTaskDelayNotice(entry: TaskCollaborationEntry): boolean {
  return entry.authorKind === 'system' && entry.authorId === AUTHOR && entry.kind === 'progress';
}

export function isCurrentTaskDelayNotice(entry: TaskCollaborationEntry, conversationId: string, now = Date.now()): boolean {
  if (getTaskNotificationPreference(entry.taskId, conversationId) === 'final_only') return false;
  const db = getSqliteDatabase();
  const row = db.prepare(`${eligibleTasks} SELECT * FROM delays WHERE task_id = ? AND conversation_id = ? AND reason IS NOT NULL`)
    .get(delayParameters(now), personalAgentId('local-owner'), entry.taskId, conversationId) as unknown as Delay | undefined;
  return !!row && !!db.prepare('SELECT 1 FROM task_collaboration_entries WHERE entry_id = ? AND idempotency_key = ?').get(entry.id, delayKey(row));
}
