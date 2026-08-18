import { randomUUID } from 'node:crypto';

import { mediaRefsToUserTurnAttachments, type UserTurnInput } from '../gateway/user-turn-input.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';
import { OutcomeExecutionStateRepository, type OutcomeExecutionState } from './outcome-execution-state.js';
import { OutcomeRepository } from './outcome-repository.js';

const log = createLogger('OutcomeRunner');

export type OutcomeQueueStatus = 'queued' | 'running' | 'retry_waiting' | 'succeeded' | 'failed' | 'skipped';

export interface OutcomeRunExecutionContext {
  workItemId?: string;
  contextTraceId?: string;
  parentRunId?: string;
  triggerKind: 'user' | 'schedule' | 'webhook' | 'proactive' | 'retry';
  strategy?: string;
}

export interface OutcomeQueueItem {
  id: string;
  outcomeId: string;
  status: OutcomeQueueStatus;
  attempts: number;
  maxRetries: number;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  nextRunAt?: number;
  sessionKey?: string;
  userTurn?: UserTurnInput;
  executionContext?: OutcomeRunExecutionContext;
  lastError?: string;
  source: 'api' | 'cron' | 'workflow' | 'system';
}

export interface EnqueueOutcomeOptions {
  userTurn?: UserTurnInput;
  maxRetries?: number;
  source?: OutcomeQueueItem['source'];
  executionContext?: OutcomeRunExecutionContext;
}

type OutcomeQueueRow = {
  queue_id: string;
  outcome_id: string;
  status: OutcomeQueueStatus;
  payload_json: string;
  attempts: number;
  max_retries: number;
  enqueued_at: number;
  started_at: number | null;
  finished_at: number | null;
  next_run_at: number | null;
  session_key: string | null;
  last_error: string | null;
  source: OutcomeQueueItem['source'];
};

function fromRow(row: OutcomeQueueRow): OutcomeQueueItem {
  const payload = JSON.parse(row.payload_json) as Pick<OutcomeQueueItem, 'userTurn' | 'executionContext'>;
  return {
    id: row.queue_id,
    outcomeId: row.outcome_id,
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

class OutcomeQueueStore {
  enqueue(input: {
    outcomeId: string;
    userTurn?: UserTurnInput;
    executionContext?: OutcomeRunExecutionContext;
    maxRetries: number;
    source: OutcomeQueueItem['source'];
  }): OutcomeQueueItem {
    return runSqliteWriteTransaction((db) => {
      const existing = db.prepare(
        `SELECT * FROM outcome_queue
         WHERE outcome_id = ? AND status IN ('queued', 'retry_waiting')
         ORDER BY enqueued_at DESC LIMIT 1`,
      ).get(input.outcomeId) as OutcomeQueueRow | undefined;
      if (existing) return fromRow(existing);
      const now = Date.now();
      const id = randomUUID();
      db.prepare(
        `INSERT INTO outcome_queue (
          queue_id, outcome_id, status, payload_json, attempts, max_retries,
          enqueued_at, source
        ) VALUES (?, ?, 'queued', ?, 0, ?, ?, ?)`,
      ).run(
        id,
        input.outcomeId,
        JSON.stringify({ userTurn: input.userTurn, executionContext: input.executionContext }),
        input.maxRetries,
        now,
        input.source,
      );
      return fromRow(db.prepare('SELECT * FROM outcome_queue WHERE queue_id = ?').get(id) as OutcomeQueueRow);
    });
  }

  claimNext(now = Date.now()): OutcomeQueueItem | undefined {
    return runSqliteWriteTransaction((db) => {
      const row = db.prepare(
        `SELECT * FROM outcome_queue
         WHERE status = 'queued'
            OR (status = 'retry_waiting' AND COALESCE(next_run_at, 0) <= ?)
         ORDER BY enqueued_at ASC LIMIT 1`,
      ).get(now) as OutcomeQueueRow | undefined;
      if (!row) return undefined;
      db.prepare(
        `UPDATE outcome_queue SET status = 'running', started_at = ?,
         attempts = attempts + 1, last_error = NULL WHERE queue_id = ?`,
      ).run(Date.now(), row.queue_id);
      return fromRow(db.prepare('SELECT * FROM outcome_queue WHERE queue_id = ?').get(row.queue_id) as OutcomeQueueRow);
    });
  }

  update(id: string, patch: Partial<OutcomeQueueRow>): OutcomeQueueItem | undefined {
    return runSqliteWriteTransaction((db) => {
      const current = db.prepare('SELECT * FROM outcome_queue WHERE queue_id = ?').get(id) as OutcomeQueueRow | undefined;
      if (!current) return undefined;
      const next = { ...current, ...patch };
      db.prepare(
        `UPDATE outcome_queue SET status = ?, attempts = ?, started_at = ?,
         finished_at = ?, next_run_at = ?, session_key = ?, last_error = ?
         WHERE queue_id = ?`,
      ).run(
        next.status, next.attempts, next.started_at, next.finished_at,
        next.next_run_at, next.session_key, next.last_error, id,
      );
      return fromRow(db.prepare('SELECT * FROM outcome_queue WHERE queue_id = ?').get(id) as OutcomeQueueRow);
    });
  }

  list(limit = 200): OutcomeQueueItem[] {
    return (getSqliteDatabase().prepare(
      'SELECT * FROM outcome_queue ORDER BY enqueued_at DESC LIMIT ?',
    ).all(Math.max(1, Math.min(500, Math.floor(limit)))) as OutcomeQueueRow[]).map(fromRow);
  }

  resetRunning(): void {
    getSqliteDatabase().prepare(
      `UPDATE outcome_queue SET status = 'retry_waiting', next_run_at = ?,
       last_error = 'Gateway restarted during outcome execution' WHERE status = 'running'`,
    ).run(Date.now());
  }
}

function initialTurn(outcome: NonNullable<ReturnType<OutcomeRepository['get']>>, state: OutcomeExecutionState): UserTurnInput {
  const contract = outcome.contract;
  const parts = [`Outcome:\n${outcome.objective}`];
  if (contract?.deliverables.length) parts.push(`Deliverables:\n${contract.deliverables.map((item) => `- ${item}`).join('\n')}`);
  if (contract?.acceptanceCriteria.length) parts.push(`Acceptance criteria:\n${contract.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}`);
  if (contract?.constraints.length) parts.push(`Constraints:\n${contract.constraints.map((item) => `- ${item}`).join('\n')}`);
  if (state.contextMessage?.text.trim()) parts.push(`Context:\n${state.contextMessage.text.trim()}`);
  return {
    text: parts.join('\n\n'),
    attachments: mediaRefsToUserTurnAttachments(state.contextMessage?.attachments),
  };
}

export interface OutcomeRunnerOptions {
  maxConcurrent?: number;
  defaultMaxRetries?: number;
  retryBaseMs?: number;
  ensureSession: (outcomeId: string, state: OutcomeExecutionState, context?: OutcomeRunExecutionContext) => Promise<string>;
  bindExecutionContext?: (sessionKey: string, outcomeId: string, state: OutcomeExecutionState, context?: OutcomeRunExecutionContext) => Promise<void>;
  hasActiveRun: (sessionKey: string) => boolean;
  runTurn: (sessionKey: string, userTurn: UserTurnInput) => Promise<void>;
  emit?: (type: string, payload: unknown) => void;
}

export class OutcomeRunner {
  readonly #outcomes = new OutcomeRepository();
  readonly #states = new OutcomeExecutionStateRepository();
  readonly #queue = new OutcomeQueueStore();
  #active = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: OutcomeRunnerOptions) {
    this.#queue.resetRunning();
    this.schedule(0);
  }

  enqueue(outcomeId: string, options: EnqueueOutcomeOptions = {}): OutcomeQueueItem {
    const item = this.#queue.enqueue({
      outcomeId,
      maxRetries: Math.max(0, Math.floor(options.maxRetries ?? this.options.defaultMaxRetries ?? 2)),
      userTurn: options.userTurn,
      executionContext: options.executionContext,
      source: options.source ?? 'api',
    });
    this.emit(item);
    this.schedule(0);
    return item;
  }

  snapshot(): OutcomeQueueItem[] {
    return this.#queue.list();
  }

  private schedule(delayMs: number): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.pump();
    }, delayMs);
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
    const next = this.#queue.list().filter((item) => item.status === 'retry_waiting' && item.nextRunAt)
      .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))[0];
    if (next?.nextRunAt) this.schedule(Math.max(0, next.nextRunAt - Date.now()));
  }

  private async run(item: OutcomeQueueItem): Promise<void> {
    this.emit(item);
    try {
      const outcome = this.#outcomes.get(item.outcomeId);
      const state = this.#states.get(item.outcomeId);
      if (!outcome || !state) return this.finish(item, 'failed', 'Outcome execution state not found');
      if (outcome.internalStatus === 'completed' || outcome.internalStatus === 'cancelled') {
        return this.finish(item, 'skipped', `Outcome is ${outcome.internalStatus}`);
      }
      const sessionKey = state.activeSessionKey ?? await this.options.ensureSession(outcome.id, state, item.executionContext);
      item = this.#queue.update(item.id, { session_key: sessionKey }) ?? { ...item, sessionKey };
      await this.options.bindExecutionContext?.(sessionKey, outcome.id, this.#states.get(outcome.id) ?? state, item.executionContext);
      if (this.options.hasActiveRun(sessionKey)) return this.retry(item, 'Outcome session already has an active run');
      const userTurn = item.userTurn ?? (state.nextAction
        ? { text: state.nextAction }
        : initialTurn(outcome, state));
      await this.options.runTurn(sessionKey, userTurn);
      this.finish(item, 'succeeded');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (item.attempts <= item.maxRetries) this.retry(item, message);
      else this.finish(item, 'failed', message);
    }
  }

  private retry(item: OutcomeQueueItem, error: string): void {
    const base = Math.max(1_000, this.options.retryBaseMs ?? 5_000);
    const nextRunAt = Date.now() + base * 2 ** Math.max(0, item.attempts - 1);
    const updated = this.#queue.update(item.id, {
      status: 'retry_waiting', next_run_at: nextRunAt, last_error: error, finished_at: null,
    }) ?? { ...item, status: 'retry_waiting' as const, nextRunAt, lastError: error };
    log.warn({ outcomeId: item.outcomeId, attempts: item.attempts, nextRunAt, errorMessage: error }, `Outcome execution queued for retry: ${error}`);
    this.emit(updated);
    this.schedule(Math.max(0, nextRunAt - Date.now()));
  }

  private finish(item: OutcomeQueueItem, status: OutcomeQueueStatus, error?: string): void {
    const updated = this.#queue.update(item.id, {
      status, finished_at: Date.now(), last_error: error ?? null,
    }) ?? { ...item, status, finishedAt: Date.now(), lastError: error };
    if (status === 'failed') log.warn({ outcomeId: item.outcomeId, errorMessage: error }, `Outcome execution failed: ${error}`);
    this.emit(updated);
  }

  private emit(item: OutcomeQueueItem): void {
    this.options.emit?.('outcome.queue.updated', { item: { ...item } });
  }
}
