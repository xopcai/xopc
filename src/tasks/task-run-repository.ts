import { randomUUID } from 'node:crypto';

import type {
  ActorRef,
  TaskExecutorKind,
  TaskRun,
  TaskRunEvent,
  TaskRunReceipt,
  TaskRunStatus,
  TaskWait,
  TaskWaitKind,
} from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import { enqueueTaskAttentionRequiredEvent } from './task-change-events.js';

const ACTIVE_RUN_STATUSES: TaskRunStatus[] = ['queued', 'running', 'waiting', 'verifying'];

type TaskRunRow = {
  run_id: string;
  task_id: string;
  root_run_id: string;
  parent_run_id: string | null;
  attempt: number;
  status: TaskRunStatus;
  executor_kind: TaskExecutorKind;
  executor_ref_json: string;
  trigger_json: string;
  correlation_id: string;
  causation_id: string | null;
  idempotency_key: string;
  contract_version: number;
  context_snapshot_id: string | null;
  policy_snapshot_json: string | null;
  session_key: string | null;
  queued_at: number;
  scheduled_at: number | null;
  started_at: number | null;
  heartbeat_at: number | null;
  completed_at: number | null;
  timeout_at: number | null;
  lease_owner: string | null;
  lease_expires_at: number | null;
  retry_policy_json: string;
  retry_of_run_id: string | null;
  terminal_code: string | null;
  terminal_message: string | null;
  version: number;
};

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

type TaskRunReceiptRow = {
  run_id: string;
  status: TaskRunReceipt['status'];
  summary: string;
  changes_json: string;
  evidence_json: string;
  verification_json: string;
  remaining_work_json: string;
  next_action: string | null;
  needs_user: number;
  completion_verdict: TaskRunReceipt['completionVerdict'] | null;
  failure_json: string | null;
  judgment_json: string | null;
  context_trace_id: string | null;
  finalized_at: number;
};

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function fromRow(row: TaskRunRow): TaskRun {
  return {
    id: row.run_id,
    taskId: row.task_id,
    rootRunId: row.root_run_id,
    ...(row.parent_run_id ? { parentRunId: row.parent_run_id } : {}),
    attempt: row.attempt,
    status: row.status,
    executorKind: row.executor_kind,
    executorRef: parseJson<Record<string, unknown>>(row.executor_ref_json),
    trigger: parseJson<Record<string, unknown>>(row.trigger_json),
    correlationId: row.correlation_id,
    ...(row.causation_id ? { causationId: row.causation_id } : {}),
    idempotencyKey: row.idempotency_key,
    contractVersion: row.contract_version,
    ...(row.context_snapshot_id ? { contextSnapshotId: row.context_snapshot_id } : {}),
    ...(row.policy_snapshot_json
      ? { policySnapshot: parseJson<Record<string, unknown>>(row.policy_snapshot_json) }
      : {}),
    ...(row.session_key ? { sessionKey: row.session_key } : {}),
    queuedAt: row.queued_at,
    ...(row.scheduled_at === null ? {} : { scheduledAt: row.scheduled_at }),
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.heartbeat_at === null ? {} : { heartbeatAt: row.heartbeat_at }),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    ...(row.timeout_at === null ? {} : { timeoutAt: row.timeout_at }),
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at === null ? {} : { leaseExpiresAt: row.lease_expires_at }),
    retryPolicy: parseJson<Record<string, unknown>>(row.retry_policy_json),
    ...(row.retry_of_run_id ? { retryOfRunId: row.retry_of_run_id } : {}),
    ...(row.terminal_code ? { terminalCode: row.terminal_code } : {}),
    ...(row.terminal_message ? { terminalMessage: row.terminal_message } : {}),
    version: row.version,
  };
}

function waitFromRow(row: TaskWaitRow): TaskWait {
  return {
    id: row.wait_id,
    taskId: row.task_id,
    ...(row.task_run_id ? { taskRunId: row.task_run_id } : {}),
    kind: row.kind,
    status: row.status,
    reason: row.reason,
    condition: parseJson<Record<string, unknown>>(row.condition_json),
    ...(row.resume_at === null ? {} : { resumeAt: row.resume_at }),
    ...(row.resolved_by_json ? { resolvedBy: parseJson<Record<string, unknown>>(row.resolved_by_json) } : {}),
    ...(row.resolution_json ? { resolution: parseJson<unknown>(row.resolution_json) } : {}),
    createdAt: row.created_at,
    ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at }),
  };
}

function receiptFromRow(row: TaskRunReceiptRow): TaskRunReceipt {
  return {
    runId: row.run_id,
    status: row.status,
    summary: row.summary,
    changes: parseJson<TaskRunReceipt['changes']>(row.changes_json),
    evidence: parseJson<TaskRunReceipt['evidence']>(row.evidence_json),
    verification: parseJson<TaskRunReceipt['verification']>(row.verification_json),
    remainingWork: parseJson<string[]>(row.remaining_work_json),
    ...(row.next_action ? { nextAction: row.next_action } : {}),
    needsUser: row.needs_user === 1,
    ...(row.completion_verdict ? { completionVerdict: row.completion_verdict } : {}),
    ...(row.failure_json ? { failure: parseJson<NonNullable<TaskRunReceipt['failure']>>(row.failure_json) } : {}),
    ...(row.judgment_json ? { judgment: parseJson<NonNullable<TaskRunReceipt['judgment']>>(row.judgment_json) } : {}),
    ...(row.context_trace_id ? { contextTraceId: row.context_trace_id } : {}),
    finalizedAt: row.finalized_at,
  };
}

export interface TaskRunCreateInput {
  id?: string;
  taskId: string;
  parentRunId?: string;
  executorKind: TaskExecutorKind;
  executorRef: Record<string, unknown>;
  trigger: Record<string, unknown>;
  correlationId: string;
  causationId?: string;
  idempotencyKey: string;
  contractVersion: number;
  scheduledAt?: number;
  sessionKey?: string;
  retryPolicy?: Record<string, unknown>;
  retryOfRunId?: string;
  now?: number;
}

export class TaskRunRepository {
  create(input: TaskRunCreateInput): TaskRun {
    const id = input.id ?? randomUUID();
    const rootRunId = input.parentRunId
      ? this.require(input.parentRunId).rootRunId
      : id;
    const now = input.now ?? Date.now();
    return runSqliteWriteTransaction((db) => {
      const attemptRow = db.prepare(
        `SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt FROM task_runs
         WHERE task_id = ? AND parent_run_id IS NULL`,
      ).get(input.taskId) as { attempt: number };
      db.prepare(
        `INSERT INTO task_runs (
          run_id, task_id, root_run_id, parent_run_id, attempt, status,
          executor_kind, executor_ref_json, trigger_json, correlation_id,
          causation_id, idempotency_key, contract_version, session_key,
          queued_at, scheduled_at, retry_policy_json, retry_of_run_id, version
        ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ).run(
        id,
        input.taskId,
        rootRunId,
        input.parentRunId ?? null,
        input.parentRunId ? 1 : attemptRow.attempt,
        input.executorKind,
        JSON.stringify(input.executorRef),
        JSON.stringify(input.trigger),
        input.correlationId,
        input.causationId ?? null,
        input.idempotencyKey,
        input.contractVersion,
        input.sessionKey ?? null,
        now,
        input.scheduledAt ?? null,
        JSON.stringify(input.retryPolicy ?? {}),
        input.retryOfRunId ?? null,
      );
      this.appendEvent(db, id, 'task_run.created', {
        executorKind: input.executorKind,
        scheduledAt: input.scheduledAt,
      }, { kind: 'system' }, now);
      return this.require(id);
    });
  }

  get(id: string): TaskRun | undefined {
    const row = getSqliteDatabase().prepare(
      'SELECT * FROM task_runs WHERE run_id = ?',
    ).get(id) as TaskRunRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  require(id: string): TaskRun {
    const run = this.get(id);
    if (!run) throw new Error(`TaskRun not found: ${id}`);
    return run;
  }

  getByIdempotencyKey(key: string): TaskRun | undefined {
    const row = getSqliteDatabase().prepare(
      'SELECT * FROM task_runs WHERE idempotency_key = ?',
    ).get(key) as TaskRunRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  getActiveRoot(taskId: string): TaskRun | undefined {
    const row = getSqliteDatabase().prepare(
      `SELECT * FROM task_runs WHERE task_id = ? AND parent_run_id IS NULL
       AND status IN ('queued', 'running', 'waiting', 'verifying')
       ORDER BY queued_at DESC LIMIT 1`,
    ).get(taskId) as TaskRunRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  getLatestRoot(taskId: string): TaskRun | undefined {
    const row = getSqliteDatabase().prepare(
      `SELECT * FROM task_runs WHERE task_id = ? AND parent_run_id IS NULL
       ORDER BY queued_at DESC LIMIT 1`,
    ).get(taskId) as TaskRunRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  listByTask(taskId: string, limit = 100): TaskRun[] {
    return (getSqliteDatabase().prepare(
      `SELECT * FROM task_runs WHERE task_id = ? ORDER BY queued_at DESC LIMIT ?`,
    ).all(taskId, Math.max(1, Math.min(500, Math.floor(limit)))) as TaskRunRow[]).map(fromRow);
  }

  claimNext(input: {
    owner: string;
    leaseMs: number;
    executorKind?: TaskExecutorKind;
    now?: number;
  }): TaskRun | undefined {
    const now = input.now ?? Date.now();
    return runSqliteWriteTransaction((db) => {
      const row = db.prepare(
        `SELECT * FROM task_runs
         WHERE (
           status = 'queued'
           OR (status = 'waiting' AND NOT EXISTS (
             SELECT 1 FROM task_waits wait
             WHERE wait.task_run_id = task_runs.run_id AND wait.status = 'active'
           ))
         )
           AND (? IS NULL OR executor_kind = ?)
           AND COALESCE(scheduled_at, 0) <= ?
           AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
         ORDER BY COALESCE(scheduled_at, queued_at), queued_at LIMIT 1`,
      ).get(input.executorKind ?? null, input.executorKind ?? null, now, now) as TaskRunRow | undefined;
      if (!row) return undefined;
      const result = db.prepare(
        `UPDATE task_runs SET lease_owner = ?, lease_expires_at = ?, version = version + 1
         WHERE run_id = ? AND version = ?
           AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
      ).run(input.owner, now + input.leaseMs, row.run_id, row.version, now);
      return result.changes === 0 ? undefined : this.get(row.run_id);
    });
  }

  start(input: {
    runId: string;
    expectedVersion: number;
    contextSnapshotId: string;
    policySnapshot: Record<string, unknown>;
    sessionKey?: string;
    timeoutAt?: number;
    actor?: ActorRef;
    now?: number;
  }): TaskRun | undefined {
    const now = input.now ?? Date.now();
    return this.transition({
      runId: input.runId,
      expectedVersion: input.expectedVersion,
      from: ['queued'],
      to: 'running',
      fields: {
        context_snapshot_id: input.contextSnapshotId,
        policy_snapshot_json: JSON.stringify(input.policySnapshot),
        session_key: input.sessionKey ?? null,
        started_at: now,
        heartbeat_at: now,
        timeout_at: input.timeoutAt ?? null,
      },
      actor: input.actor ?? { kind: 'system' },
      now,
    });
  }

  setStatus(input: {
    runId: string;
    expectedVersion: number;
    from: TaskRunStatus[];
    to: Extract<TaskRunStatus, 'running' | 'waiting' | 'verifying'>;
    actor?: ActorRef;
    now?: number;
  }): TaskRun | undefined {
    return this.transition({
      ...input,
      fields: input.to === 'running'
        ? { heartbeat_at: input.now ?? Date.now() }
        : input.to === 'waiting'
          ? { lease_owner: null, lease_expires_at: null }
          : {},
      actor: input.actor ?? { kind: 'system' },
      now: input.now ?? Date.now(),
    });
  }

  heartbeat(input: { runId: string; owner: string; leaseMs: number; now?: number }): TaskRun | undefined {
    const now = input.now ?? Date.now();
    const result = getSqliteDatabase().prepare(
      `UPDATE task_runs SET heartbeat_at = ?, lease_expires_at = ?, version = version + 1
       WHERE run_id = ? AND lease_owner = ?
         AND status IN ('running', 'waiting', 'verifying')`,
    ).run(now, now + input.leaseMs, input.runId, input.owner);
    return result.changes === 0 ? undefined : this.get(input.runId);
  }

  finalize(input: {
    runId: string;
    expectedVersion: number;
    receipt: Omit<TaskRunReceipt, 'runId' | 'finalizedAt'>;
    actor?: ActorRef;
    terminalCode?: string;
    terminalMessage?: string;
    now?: number;
  }): TaskRun | undefined {
    const now = input.now ?? Date.now();
    return runSqliteWriteTransaction((db) => {
      const run = this.get(input.runId);
      if (!run || run.version !== input.expectedVersion || !ACTIVE_RUN_STATUSES.includes(run.status)) {
        return undefined;
      }
      const result = db.prepare(
        `UPDATE task_runs SET status = ?, completed_at = ?, terminal_code = ?,
         terminal_message = ?, lease_owner = NULL, lease_expires_at = NULL,
         version = version + 1 WHERE run_id = ? AND version = ?`,
      ).run(
        input.receipt.status,
        now,
        input.terminalCode ?? null,
        input.terminalMessage ?? null,
        input.runId,
        input.expectedVersion,
      );
      if (result.changes === 0) return undefined;
      db.prepare(
        `INSERT INTO task_run_receipts (
          run_id, status, summary, changes_json, evidence_json, verification_json,
          remaining_work_json, next_action, needs_user, completion_verdict,
          failure_json, judgment_json, context_trace_id, finalized_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.runId,
        input.receipt.status,
        input.receipt.summary,
        JSON.stringify(input.receipt.changes),
        JSON.stringify(input.receipt.evidence),
        JSON.stringify(input.receipt.verification),
        JSON.stringify(input.receipt.remainingWork),
        input.receipt.nextAction ?? null,
        input.receipt.needsUser ? 1 : 0,
        input.receipt.completionVerdict ?? null,
        input.receipt.failure ? JSON.stringify(input.receipt.failure) : null,
        input.receipt.judgment ? JSON.stringify(input.receipt.judgment) : null,
        input.receipt.contextTraceId ?? null,
        now,
      );
      this.appendEvent(
        db,
        input.runId,
        `task_run.${input.receipt.status}`,
        { completionVerdict: input.receipt.completionVerdict },
        input.actor ?? { kind: 'system' },
        now,
      );
      return this.get(input.runId);
    });
  }

  getReceipt(runId: string): TaskRunReceipt | undefined {
    const row = getSqliteDatabase().prepare(
      'SELECT * FROM task_run_receipts WHERE run_id = ?',
    ).get(runId) as TaskRunReceiptRow | undefined;
    return row ? receiptFromRow(row) : undefined;
  }

  listReceipts(taskId: string, limit = 100): TaskRunReceipt[] {
    return (getSqliteDatabase().prepare(
      `SELECT receipt.* FROM task_run_receipts receipt
       JOIN task_runs run ON run.run_id = receipt.run_id
       WHERE run.task_id = ? ORDER BY receipt.finalized_at DESC LIMIT ?`,
    ).all(taskId, Math.max(1, Math.min(500, Math.floor(limit)))) as TaskRunReceiptRow[])
      .map(receiptFromRow);
  }

  recordFeedback(input: {
    runId: string;
    rating: 'helpful' | 'not_helpful';
    reason?: string;
    now?: number;
  }): { id: string; runId: string; rating: 'helpful' | 'not_helpful'; reason?: string; createdAt: number } {
    this.require(input.runId);
    const id = randomUUID();
    const createdAt = input.now ?? Date.now();
    getSqliteDatabase().prepare(
      `INSERT INTO task_run_feedback (
        feedback_id, run_id, rating, reason, needs_correction, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.runId,
      input.rating,
      input.reason?.trim() || null,
      input.rating === 'not_helpful' ? 1 : 0,
      createdAt,
    );
    return {
      id,
      runId: input.runId,
      rating: input.rating,
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      createdAt,
    };
  }

  createWait(input: {
    taskId: string;
    taskRunId?: string;
    kind: TaskWaitKind;
    reason: string;
    condition?: Record<string, unknown>;
    resumeAt?: number;
    actor?: ActorRef;
    now?: number;
  }): TaskWait {
    const id = randomUUID();
    const now = input.now ?? Date.now();
    runSqliteWriteTransaction((db) => {
      db.prepare(
        `INSERT INTO task_waits (
          wait_id, task_id, task_run_id, kind, status, reason,
          condition_json, resume_at, created_at
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      ).run(
        id,
        input.taskId,
        input.taskRunId ?? null,
        input.kind,
        input.reason.trim(),
        JSON.stringify(input.condition ?? {}),
        input.resumeAt ?? null,
        now,
      );
      if (input.taskRunId) {
        this.appendEvent(db, input.taskRunId, 'task_run.wait_created', {
          waitId: id,
          kind: input.kind,
          reason: input.reason.trim(),
          resumeAt: input.resumeAt,
        }, input.actor ?? { kind: 'system' }, now);
      }
      if (input.kind === 'user_input' || input.kind === 'approval') {
        const task = db.prepare(
          'SELECT title, project_id FROM tasks WHERE task_id = ?',
        ).get(input.taskId) as { title: string; project_id: string | null } | undefined;
        if (task) {
          enqueueTaskAttentionRequiredEvent(db, {
            taskId: input.taskId,
            taskTitle: task.title,
            ...(task.project_id ? { projectId: task.project_id } : {}),
            reason: input.kind,
            detail: input.reason.trim(),
            correlationId: id,
            occurredAt: now,
          });
        }
      }
    });
    return this.requireWait(id);
  }

  getWait(waitId: string): TaskWait | undefined {
    const row = getSqliteDatabase().prepare(
      'SELECT * FROM task_waits WHERE wait_id = ?',
    ).get(waitId) as TaskWaitRow | undefined;
    return row ? waitFromRow(row) : undefined;
  }

  requireWait(waitId: string): TaskWait {
    const wait = this.getWait(waitId);
    if (!wait) throw new Error(`TaskWait not found: ${waitId}`);
    return wait;
  }

  listActiveWaits(taskId: string): TaskWait[] {
    return (getSqliteDatabase().prepare(
      `SELECT * FROM task_waits WHERE task_id = ? AND status = 'active'
       ORDER BY created_at ASC`,
    ).all(taskId) as TaskWaitRow[]).map(waitFromRow);
  }

  resolveWait(input: {
    waitId: string;
    actor: ActorRef;
    resolution?: unknown;
    now?: number;
  }): TaskWait | undefined {
    const now = input.now ?? Date.now();
    return runSqliteWriteTransaction((db) => {
      const wait = this.getWait(input.waitId);
      if (!wait || wait.status !== 'active') return undefined;
      const result = db.prepare(
        `UPDATE task_waits SET status = 'resolved', resolved_by_json = ?,
         resolution_json = ?, resolved_at = ? WHERE wait_id = ? AND status = 'active'`,
      ).run(
        JSON.stringify(input.actor),
        input.resolution === undefined ? null : JSON.stringify(input.resolution),
        now,
        input.waitId,
      );
      if (result.changes === 0) return undefined;
      if (wait.taskRunId) {
        this.appendEvent(db, wait.taskRunId, 'task_run.wait_resolved', {
          waitId: wait.id,
          resolution: input.resolution,
        }, input.actor, now);
      }
      return this.getWait(input.waitId);
    });
  }

  listEvents(runId: string): TaskRunEvent[] {
    const rows = getSqliteDatabase().prepare(
      `SELECT event_id, run_id, sequence, type, payload_json, actor_json, occurred_at
       FROM task_run_events WHERE run_id = ? ORDER BY sequence`,
    ).all(runId) as Array<{
      event_id: string;
      run_id: string;
      sequence: number;
      type: string;
      payload_json: string;
      actor_json: string;
      occurred_at: number;
    }>;
    return rows.map((row) => ({
      id: row.event_id,
      runId: row.run_id,
      sequence: row.sequence,
      type: row.type,
      payload: parseJson<Record<string, unknown>>(row.payload_json),
      actor: parseJson<Record<string, unknown>>(row.actor_json),
      occurredAt: row.occurred_at,
    }));
  }

  private transition(input: {
    runId: string;
    expectedVersion: number;
    from: TaskRunStatus[];
    to: TaskRunStatus;
    fields: Record<string, string | number | null>;
    actor: ActorRef;
    now: number;
  }): TaskRun | undefined {
    const allowedColumns = new Set([
      'context_snapshot_id', 'policy_snapshot_json', 'session_key', 'started_at',
      'heartbeat_at', 'timeout_at', 'lease_owner', 'lease_expires_at',
    ]);
    const entries = Object.entries(input.fields);
    for (const [column] of entries) {
      if (!allowedColumns.has(column)) throw new Error(`Unsupported TaskRun field: ${column}`);
    }
    return runSqliteWriteTransaction((db) => {
      const placeholders = input.from.map(() => '?').join(', ');
      const assignments = entries.map(([column]) => `${column} = ?`);
      const result = db.prepare(
        `UPDATE task_runs SET status = ?, ${assignments.length ? `${assignments.join(', ')}, ` : ''}
         version = version + 1 WHERE run_id = ? AND version = ? AND status IN (${placeholders})`,
      ).run(
        input.to,
        ...entries.map(([, value]) => value),
        input.runId,
        input.expectedVersion,
        ...input.from,
      );
      if (result.changes === 0) return undefined;
      this.appendEvent(db, input.runId, `task_run.${input.to}`, {}, input.actor, input.now);
      return this.get(input.runId);
    });
  }

  private appendEvent(
    db: ReturnType<typeof getSqliteDatabase>,
    runId: string,
    type: string,
    payload: Record<string, unknown>,
    actor: ActorRef,
    occurredAt: number,
  ): void {
    const row = db.prepare(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM task_run_events WHERE run_id = ?',
    ).get(runId) as { sequence: number };
    db.prepare(
      `INSERT INTO task_run_events (
        event_id, run_id, sequence, type, payload_json, actor_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      runId,
      row.sequence,
      type,
      JSON.stringify(payload),
      JSON.stringify(actor),
      occurredAt,
    );
  }
}
