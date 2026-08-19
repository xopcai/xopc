import { randomUUID } from 'node:crypto';

import { mediaRefsToUserTurnAttachments, type UserTurnInput } from '../gateway/user-turn-input.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';
import { TaskRepository, type TaskRuntime } from './task-repository.js';

const log = createLogger('TaskRunner');

export type TaskQueueStatus = 'queued' | 'scheduled' | 'running' | 'retry_waiting' | 'succeeded' | 'failed' | 'skipped';

export interface TaskRunExecutionContext {
  contextTraceId?: string;
  parentRunId?: string;
  triggerKind: 'user' | 'schedule' | 'webhook' | 'proactive' | 'retry';
  strategy?: string;
}

export interface TaskQueueItem {
  id: string;
  taskId: string;
  status: TaskQueueStatus;
  attempts: number;
  maxRetries: number;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  nextRunAt?: number;
  sessionKey?: string;
  userTurn?: UserTurnInput;
  executionContext?: TaskRunExecutionContext;
  lastError?: string;
  source: 'api' | 'cron' | 'workflow' | 'system';
}

export interface EnqueueTaskOptions {
  userTurn?: UserTurnInput;
  maxRetries?: number;
  source?: TaskQueueItem['source'];
  executionContext?: TaskRunExecutionContext;
  notBefore?: number;
}

type TaskQueueRow = {
  queue_id: string;
  task_id: string;
  status: TaskQueueStatus;
  payload_json: string;
  attempts: number;
  max_retries: number;
  enqueued_at: number;
  started_at: number | null;
  finished_at: number | null;
  next_run_at: number | null;
  session_key: string | null;
  last_error: string | null;
  source: TaskQueueItem['source'];
};

function fromRow(row: TaskQueueRow): TaskQueueItem {
  const payload = JSON.parse(row.payload_json) as Pick<TaskQueueItem, 'userTurn' | 'executionContext'>;
  return {
    id: row.queue_id,
    taskId: row.task_id,
    status: row.status,
    attempts: row.attempts,
    maxRetries: row.max_retries,
    enqueuedAt: row.enqueued_at,
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
    ...(row.next_run_at === null ? {} : { nextRunAt: row.next_run_at }),
    ...(row.session_key ? { sessionKey: row.session_key } : {}),
    ...(payload.userTurn ? { userTurn: payload.userTurn } : {}),
    ...(payload.executionContext ? { executionContext: payload.executionContext } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    source: row.source,
  };
}

class TaskQueueStore {
  enqueue(input: {
    taskId: string;
    userTurn?: UserTurnInput;
    executionContext?: TaskRunExecutionContext;
    maxRetries: number;
    source: TaskQueueItem['source'];
    notBefore?: number;
  }): TaskQueueItem {
    return runSqliteWriteTransaction((db) => {
      const existing = db.prepare(
        `SELECT * FROM task_queue
         WHERE task_id = ? AND status IN ('queued', 'scheduled', 'retry_waiting')
         ORDER BY enqueued_at DESC LIMIT 1`,
      ).get(input.taskId) as TaskQueueRow | undefined;
      const now = Date.now();
      const scheduled = input.notBefore !== undefined && input.notBefore > now;
      if (existing) {
        if (scheduled || existing.status === 'queued') return fromRow(existing);
        db.prepare(
          `UPDATE task_queue SET status = 'queued', payload_json = ?, max_retries = ?,
           next_run_at = NULL, finished_at = NULL, last_error = NULL, source = ?
           WHERE queue_id = ?`,
        ).run(
          JSON.stringify({ userTurn: input.userTurn, executionContext: input.executionContext }),
          input.maxRetries,
          input.source,
          existing.queue_id,
        );
        return fromRow(db.prepare('SELECT * FROM task_queue WHERE queue_id = ?').get(existing.queue_id) as TaskQueueRow);
      }
      const id = randomUUID();
      db.prepare(
        `INSERT INTO task_queue (
          queue_id, task_id, status, payload_json, attempts, max_retries,
          enqueued_at, next_run_at, source
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      ).run(
        id,
        input.taskId,
        scheduled ? 'scheduled' : 'queued',
        JSON.stringify({ userTurn: input.userTurn, executionContext: input.executionContext }),
        input.maxRetries,
        now,
        scheduled ? input.notBefore : null,
        input.source,
      );
      return fromRow(db.prepare('SELECT * FROM task_queue WHERE queue_id = ?').get(id) as TaskQueueRow);
    });
  }

  claimNext(now = Date.now()): TaskQueueItem | undefined {
    return runSqliteWriteTransaction((db) => {
      const row = db.prepare(
        `SELECT * FROM task_queue
         WHERE status = 'queued'
            OR (status = 'scheduled' AND COALESCE(next_run_at, 0) <= ?)
            OR (status = 'retry_waiting' AND COALESCE(next_run_at, 0) <= ?)
         ORDER BY enqueued_at ASC LIMIT 1`,
      ).get(now, now) as TaskQueueRow | undefined;
      if (!row) return undefined;
      db.prepare(
        `UPDATE task_queue SET status = 'running', started_at = ?,
         attempts = attempts + 1, last_error = NULL WHERE queue_id = ?`,
      ).run(Date.now(), row.queue_id);
      return fromRow(db.prepare('SELECT * FROM task_queue WHERE queue_id = ?').get(row.queue_id) as TaskQueueRow);
    });
  }

  update(id: string, patch: Partial<TaskQueueRow>): TaskQueueItem | undefined {
    return runSqliteWriteTransaction((db) => {
      const current = db.prepare('SELECT * FROM task_queue WHERE queue_id = ?').get(id) as TaskQueueRow | undefined;
      if (!current) return undefined;
      const next = { ...current, ...patch };
      db.prepare(
        `UPDATE task_queue SET status = ?, attempts = ?, started_at = ?,
         finished_at = ?, next_run_at = ?, session_key = ?, last_error = ?
         WHERE queue_id = ?`,
      ).run(
        next.status, next.attempts, next.started_at, next.finished_at,
        next.next_run_at, next.session_key, next.last_error, id,
      );
      return fromRow(db.prepare('SELECT * FROM task_queue WHERE queue_id = ?').get(id) as TaskQueueRow);
    });
  }

  list(limit = 200): TaskQueueItem[] {
    return (getSqliteDatabase().prepare(
      'SELECT * FROM task_queue ORDER BY enqueued_at DESC LIMIT ?',
    ).all(Math.max(1, Math.min(500, Math.floor(limit)))) as TaskQueueRow[]).map(fromRow);
  }

  resetRunning(): void {
    getSqliteDatabase().prepare(
      `UPDATE task_queue SET status = 'retry_waiting', next_run_at = ?,
       last_error = 'Gateway restarted during task execution' WHERE status = 'running'`,
    ).run(Date.now());
  }
}

function taskTurn(task: NonNullable<ReturnType<TaskRepository['get']>>, state: TaskRuntime): UserTurnInput {
  const contract = task.contract;
  const parts = [`Task:\n${task.objective}`];
  if (contract?.expectedOutputs.length) parts.push(`Expected outputs:\n${contract.expectedOutputs.map((item) => `- ${item}`).join('\n')}`);
  if (contract?.acceptanceCriteria.length) parts.push(`Acceptance criteria:\n${contract.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}`);
  if (contract?.constraints.length) parts.push(`Constraints:\n${contract.constraints.map((item) => `- ${item}`).join('\n')}`);
  if (state.contextMessage?.text.trim()) parts.push(`Context:\n${state.contextMessage.text.trim()}`);
  if (state.nextAction?.trim()) parts.push(`Current next action:\n${state.nextAction.trim()}`);
  return {
    text: parts.join('\n\n'),
    attachments: mediaRefsToUserTurnAttachments(state.contextMessage?.attachments),
  };
}

function withTaskAttachments(userTurn: UserTurnInput, state: TaskRuntime): UserTurnInput {
  const durable = mediaRefsToUserTurnAttachments(state.contextMessage?.attachments);
  if (!durable?.length) return userTurn;
  const attachments = [...(userTurn.attachments ?? [])];
  const keys = new Set(attachments.flatMap((attachment) =>
    [attachment.uri, attachment.id].filter((value): value is string => Boolean(value))));
  for (const attachment of durable) {
    const key = attachment.uri ?? attachment.id;
    if (key && keys.has(key)) continue;
    attachments.push(attachment);
    if (key) keys.add(key);
  }
  return { ...userTurn, attachments };
}

export interface TaskRunnerOptions {
  maxConcurrent?: number;
  defaultMaxRetries?: number;
  retryBaseMs?: number;
  ensureSession: (taskId: string, state: TaskRuntime, context?: TaskRunExecutionContext) => Promise<string>;
  bindExecutionContext?: (sessionKey: string, taskId: string, state: TaskRuntime, context?: TaskRunExecutionContext) => Promise<void>;
  prepareTask?: (taskId: string) => Promise<void>;
  hasActiveRun: (sessionKey: string) => boolean;
  runTurn: (sessionKey: string, userTurn: UserTurnInput) => Promise<void>;
  emit?: (type: string, payload: unknown) => void;
}

export class TaskRunner {
  readonly #tasks = new TaskRepository();
  readonly #queue = new TaskQueueStore();
  #active = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #timerDueAt: number | undefined;

  constructor(private readonly options: TaskRunnerOptions) {
    this.#queue.resetRunning();
    this.schedule(0);
  }

  enqueue(taskId: string, options: EnqueueTaskOptions = {}): TaskQueueItem {
    const item = this.#queue.enqueue({
      taskId,
      maxRetries: Math.max(0, Math.floor(options.maxRetries ?? this.options.defaultMaxRetries ?? 2)),
      userTurn: options.userTurn,
      executionContext: options.executionContext,
      notBefore: options.notBefore,
      source: options.source ?? 'api',
    });
    this.emit(item);
    this.schedule(0);
    return item;
  }

  snapshot(): TaskQueueItem[] {
    return this.#queue.list();
  }

  private schedule(delayMs: number): void {
    const dueAt = Date.now() + delayMs;
    if (this.#timer && this.#timerDueAt !== undefined && this.#timerDueAt <= dueAt) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timerDueAt = dueAt;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#timerDueAt = undefined;
      void this.pump();
    }, delayMs);
    this.#timer.unref?.();
  }

  private async pump(): Promise<void> {
    const limit = Math.max(1, Math.floor(this.options.maxConcurrent ?? 1));
    while (this.#active < limit) {
      const item = this.#queue.claimNext();
      if (!item) break;
      this.#active += 1;
      void this.run(item).finally(() => {
        this.#active -= 1;
        this.schedule(0);
      });
    }
    if (this.#active >= limit) return;
    const next = this.#queue.list().filter((item) =>
      (item.status === 'scheduled' || item.status === 'retry_waiting') && item.nextRunAt)
      .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))[0];
    if (next?.nextRunAt) this.schedule(Math.max(0, next.nextRunAt - Date.now()));
  }

  private async run(item: TaskQueueItem): Promise<void> {
    this.emit(item);
    try {
      const task = this.#tasks.get(item.taskId);
      if (!task) return this.finish(item, 'failed', 'Task not found');
      let state = task.execution;
      if (task.status === 'completed' || task.status === 'cancelled') {
        return this.finish(item, 'skipped', `Task is ${task.status}`);
      }
      if (task.status === 'paused' || task.status === 'needs_user' || task.status === 'blocked') {
        return this.finish(item, 'skipped', `Task is ${task.status}`);
      }
      const sessionKey = state.activeSessionKey ?? await this.options.ensureSession(task.id, state, item.executionContext);
      item = this.#queue.update(item.id, { session_key: sessionKey }) ?? { ...item, sessionKey };
      await this.options.bindExecutionContext?.(
        sessionKey,
        task.id,
        this.#tasks.get(task.id)?.execution ?? state,
        item.executionContext,
      );
      await this.options.prepareTask?.(task.id);
      const prepared = this.#tasks.get(task.id) ?? task;
      state = prepared.execution;
      const missingBoundaries = (prepared.contract?.approvalRequired ?? [])
        .filter((boundary) => !state.approvedBoundaries.includes(boundary));
      if (missingBoundaries.length > 0) {
        this.#tasks.update(task.id, {
          status: 'needs_user',
          blockedReason: `Approval required: ${missingBoundaries.join(', ')}`,
        });
        return this.finish(item, 'skipped', 'Task requires approval before execution');
      }
      if (this.options.hasActiveRun(sessionKey)) return this.retry(item, 'Task session already has an active run');
      const userTurn = withTaskAttachments(item.userTurn ?? taskTurn(prepared, state), state);
      await this.options.runTurn(sessionKey, userTurn);
      this.finish(item, 'succeeded');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (item.attempts <= item.maxRetries) this.retry(item, message);
      else this.finish(item, 'failed', message);
    }
  }

  private retry(item: TaskQueueItem, error: string): void {
    const base = Math.max(1_000, this.options.retryBaseMs ?? 5_000);
    const nextRunAt = Date.now() + base * 2 ** Math.max(0, item.attempts - 1);
    const updated = this.#queue.update(item.id, {
      status: 'retry_waiting', next_run_at: nextRunAt, last_error: error, finished_at: null,
    }) ?? { ...item, status: 'retry_waiting' as const, nextRunAt, lastError: error };
    log.warn({ taskId: item.taskId, attempts: item.attempts, nextRunAt, errorMessage: error }, `Task execution queued for retry: ${error}`);
    this.emit(updated);
    this.schedule(Math.max(0, nextRunAt - Date.now()));
  }

  private finish(item: TaskQueueItem, status: TaskQueueStatus, error?: string): void {
    const updated = this.#queue.update(item.id, {
      status, finished_at: Date.now(), last_error: error ?? null,
    }) ?? { ...item, status, finishedAt: Date.now(), lastError: error };
    if (status === 'failed') log.warn({ taskId: item.taskId, errorMessage: error }, `Task execution failed: ${error}`);
    this.emit(updated);
  }

  private emit(item: TaskQueueItem): void {
    this.options.emit?.('task.queue.updated', { item: { ...item } });
  }
}
