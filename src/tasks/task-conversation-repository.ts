import { createHash, randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

export type TaskConversationStatus = 'idle' | 'active';
export type TaskSessionRole = 'primary' | 'discussion' | 'execution';
export type TaskSessionStatus = 'active' | 'completed' | 'superseded' | 'failed';

export interface TaskConversationState {
  taskId: string;
  activeConversationId?: string;
  currentExecutorAgentId?: string;
  assignmentEpoch: number;
  status: TaskConversationStatus;
  updatedAt: number;
}

export interface TaskSessionLink {
  id: string;
  taskId: string;
  conversationId: string;
  role: TaskSessionRole;
  agentId?: string;
  runId?: string;
  assignmentEpoch: number;
  status: TaskSessionStatus;
  startedAt: number;
  endedAt?: number;
  createdAt: number;
}

export interface TaskHandoffSnapshot {
  id: string;
  taskId: string;
  fromConversationId?: string;
  toConversationId: string;
  fromAgentId?: string;
  toAgentId: string;
  assignmentEpoch: number;
  payload: Record<string, unknown>;
  createdAt: number;
}

export class TaskConversationConflictError extends Error {}

type ConversationStateRow = {
  task_id: string;
  active_conversation_id: string | null;
  current_executor_agent_id: string | null;
  assignment_epoch: number;
  status: TaskConversationStatus;
  updated_at: number;
};

type TaskSessionRow = {
  task_session_id: string;
  task_id: string;
  conversation_id: string | null;
  role: TaskSessionRole;
  agent_id: string | null;
  run_id: string | null;
  assignment_epoch: number;
  status: TaskSessionStatus;
  started_at: number | null;
  ended_at: number | null;
  created_at: number;
};

type HandoffSnapshotRow = {
  snapshot_id: string;
  task_id: string;
  from_conversation_id: string | null;
  to_conversation_id: string;
  from_agent_id: string | null;
  to_agent_id: string;
  assignment_epoch: number;
  payload_json: string;
  created_at: number;
};

function stateFromRow(row: ConversationStateRow): TaskConversationState {
  return {
    taskId: row.task_id,
    ...(row.active_conversation_id ? { activeConversationId: row.active_conversation_id } : {}),
    ...(row.current_executor_agent_id ? { currentExecutorAgentId: row.current_executor_agent_id } : {}),
    assignmentEpoch: row.assignment_epoch,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function linkFromRow(row: TaskSessionRow): TaskSessionLink | undefined {
  if (!row.conversation_id) return undefined;
  return {
    id: row.task_session_id,
    taskId: row.task_id,
    conversationId: row.conversation_id,
    role: row.role,
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.run_id ? { runId: row.run_id } : {}),
    assignmentEpoch: row.assignment_epoch,
    status: row.status,
    startedAt: row.started_at ?? row.created_at,
    ...(row.ended_at === null ? {} : { endedAt: row.ended_at }),
    createdAt: row.created_at,
  };
}

function snapshotFromRow(row: HandoffSnapshotRow): TaskHandoffSnapshot {
  return {
    id: row.snapshot_id,
    taskId: row.task_id,
    ...(row.from_conversation_id ? { fromConversationId: row.from_conversation_id } : {}),
    toConversationId: row.to_conversation_id,
    ...(row.from_agent_id ? { fromAgentId: row.from_agent_id } : {}),
    toAgentId: row.to_agent_id,
    assignmentEpoch: row.assignment_epoch,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

function handoffRequestHash(input: {
  taskId: string;
  expectedTaskVersion: number;
  toAgentId: string;
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export class TaskConversationRepository {
  findHandoffByIdempotencyKey(input: {
    taskId: string;
    expectedTaskVersion: number;
    toAgentId: string;
    idempotencyKey: string;
  }): TaskHandoffSnapshot | undefined {
    const row = getSqliteDatabase().prepare(
      `SELECT request_hash, result_json FROM command_deduplication
       WHERE idempotency_key = ?`,
    ).get(input.idempotencyKey) as { request_hash: string; result_json: string } | undefined;
    if (!row) return undefined;
    const requestHash = handoffRequestHash(input);
    if (row.request_hash !== requestHash) {
      throw new TaskConversationConflictError('Idempotency key was reused with different input');
    }
    const result = JSON.parse(row.result_json) as { snapshotId: string };
    const snapshot = getSqliteDatabase().prepare(
      'SELECT * FROM task_handoff_snapshots WHERE snapshot_id = ?',
    ).get(result.snapshotId) as HandoffSnapshotRow | undefined;
    if (!snapshot || snapshot.task_id !== input.taskId) {
      throw new Error(`Task handoff snapshot not found: ${result.snapshotId}`);
    }
    return snapshotFromRow(snapshot);
  }

  getState(taskId: string): TaskConversationState | undefined {
    const row = getSqliteDatabase().prepare(
      'SELECT * FROM task_conversation_state WHERE task_id = ?',
    ).get(taskId) as ConversationStateRow | undefined;
    return row ? stateFromRow(row) : undefined;
  }

  requireState(taskId: string): TaskConversationState {
    const state = this.getState(taskId);
    if (!state) throw new Error(`Task conversation state not found: ${taskId}`);
    return state;
  }

  listSessions(taskId: string): TaskSessionLink[] {
    const rows = getSqliteDatabase().prepare(
      `SELECT * FROM task_sessions WHERE task_id = ? AND conversation_id IS NOT NULL
       ORDER BY assignment_epoch DESC, created_at DESC, task_session_id DESC`,
    ).all(taskId) as TaskSessionRow[];
    return rows.flatMap((row) => {
      const link = linkFromRow(row);
      return link ? [link] : [];
    });
  }

  getActiveSession(taskId: string): TaskSessionLink | undefined {
    const row = getSqliteDatabase().prepare(
      `SELECT * FROM task_sessions
       WHERE task_id = ? AND role = 'execution' AND status = 'active'
       LIMIT 1`,
    ).get(taskId) as TaskSessionRow | undefined;
    return row ? linkFromRow(row) : undefined;
  }

  resolveActiveExecutionSession(conversationId: string): TaskSessionLink | undefined {
    const row = getSqliteDatabase().prepare(
      `SELECT * FROM task_sessions
       WHERE conversation_id = ? AND role = 'execution' AND status = 'active'
       LIMIT 1`,
    ).get(conversationId) as TaskSessionRow | undefined;
    return row ? linkFromRow(row) : undefined;
  }

  activateExecutionSession(input: {
    taskId: string;
    conversationId: string;
    agentId: string;
    runId?: string;
    now?: number;
  }): TaskConversationState {
    const now = input.now ?? Date.now();
    return runSqliteWriteTransaction((db) => {
      const existing = db.prepare(
        'SELECT * FROM task_conversation_state WHERE task_id = ?',
      ).get(input.taskId) as ConversationStateRow | undefined;
      const current = db.prepare(
        `SELECT * FROM task_sessions
         WHERE task_id = ? AND role = 'execution' AND status = 'active'`,
      ).get(input.taskId) as TaskSessionRow | undefined;
      const sameSession = current?.conversation_id === input.conversationId;
      const assignmentEpoch = sameSession
        ? current.assignment_epoch
        : (existing?.assignment_epoch ?? 0) + 1;

      if (!sameSession) {
        db.prepare(
          `UPDATE task_sessions SET status = 'superseded', ended_at = ?
           WHERE task_id = ? AND role = 'execution' AND status = 'active'`,
        ).run(now, input.taskId);
      }

      db.prepare(
        `INSERT INTO task_sessions (
          task_session_id, task_id, conversation_id, role, created_at,
          agent_id, run_id, assignment_epoch, status, started_at, ended_at
        ) VALUES (?, ?, ?, 'execution', ?, ?, ?, ?, 'active', ?, NULL)
        ON CONFLICT(task_id, conversation_id, role) WHERE conversation_id IS NOT NULL DO UPDATE SET
          agent_id = excluded.agent_id,
          run_id = COALESCE(excluded.run_id, task_sessions.run_id),
          assignment_epoch = excluded.assignment_epoch,
          status = 'active',
          started_at = excluded.started_at,
          ended_at = NULL`,
      ).run(
        randomUUID(),
        input.taskId,
        input.conversationId,
        now,
        input.agentId,
        input.runId ?? null,
        assignmentEpoch,
        sameSession ? (current.started_at ?? now) : now,
      );

      db.prepare(
        `INSERT INTO task_conversation_state (
          task_id, active_conversation_id, current_executor_agent_id,
          assignment_epoch, status, updated_at
        ) VALUES (?, ?, ?, ?, 'active', ?)
        ON CONFLICT(task_id) DO UPDATE SET
          active_conversation_id = excluded.active_conversation_id,
          current_executor_agent_id = excluded.current_executor_agent_id,
          assignment_epoch = excluded.assignment_epoch,
          status = 'active',
          updated_at = excluded.updated_at`,
      ).run(input.taskId, input.conversationId, input.agentId, assignmentEpoch, now);

      return stateFromRow(db.prepare(
        'SELECT * FROM task_conversation_state WHERE task_id = ?',
      ).get(input.taskId) as ConversationStateRow);
    });
  }

  completeHandoff(input: {
    taskId: string;
    expectedTaskVersion: number;
    toConversationId: string;
    toAgentId: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    now?: number;
  }): { state: TaskConversationState; snapshot: TaskHandoffSnapshot; taskVersion: number } {
    const now = input.now ?? Date.now();
    return runSqliteWriteTransaction((db) => {
      const requestHash = handoffRequestHash({
        taskId: input.taskId,
        expectedTaskVersion: input.expectedTaskVersion,
        toAgentId: input.toAgentId,
      });
      const duplicate = db.prepare(
        `SELECT request_hash, result_json FROM command_deduplication
         WHERE idempotency_key = ?`,
      ).get(input.idempotencyKey) as { request_hash: string; result_json: string } | undefined;
      if (duplicate) {
        if (duplicate.request_hash !== requestHash) {
          throw new TaskConversationConflictError('Idempotency key was reused with different input');
        }
        const result = JSON.parse(duplicate.result_json) as { snapshotId: string };
        const snapshotRow = db.prepare(
          'SELECT * FROM task_handoff_snapshots WHERE snapshot_id = ?',
        ).get(result.snapshotId) as HandoffSnapshotRow;
        const taskRow = db.prepare('SELECT version FROM tasks WHERE task_id = ?').get(input.taskId) as { version: number };
        return {
          state: stateFromRow(db.prepare(
            'SELECT * FROM task_conversation_state WHERE task_id = ?',
          ).get(input.taskId) as ConversationStateRow),
          snapshot: snapshotFromRow(snapshotRow),
          taskVersion: taskRow.version,
        };
      }
      const existing = db.prepare(
        'SELECT * FROM task_conversation_state WHERE task_id = ?',
      ).get(input.taskId) as ConversationStateRow | undefined;
      if (!existing) throw new Error(`Task conversation state not found: ${input.taskId}`);
      const current = db.prepare(
        `SELECT * FROM task_sessions
         WHERE task_id = ? AND role = 'execution' AND status = 'active'`,
      ).get(input.taskId) as TaskSessionRow | undefined;
      if (current?.conversation_id === input.toConversationId && current.agent_id === input.toAgentId) {
        throw new TaskConversationConflictError('Executor is already active');
      }
      const assignmentEpoch = existing.assignment_epoch + 1;
      const taskUpdate = db.prepare(
        `UPDATE tasks SET delegate_agent_id = ?, version = version + 1, updated_at = ?
         WHERE task_id = ? AND version = ?`,
      ).run(input.toAgentId, now, input.taskId, input.expectedTaskVersion);
      if (taskUpdate.changes === 0) throw new TaskConversationConflictError('Task changed');

      db.prepare(
        `UPDATE task_sessions SET status = 'superseded', ended_at = ?
         WHERE task_id = ? AND role = 'execution' AND status = 'active'`,
      ).run(now, input.taskId);
      db.prepare(
        `INSERT INTO task_sessions (
          task_session_id, task_id, conversation_id, role, created_at,
          agent_id, assignment_epoch, status, started_at, ended_at
        ) VALUES (?, ?, ?, 'execution', ?, ?, ?, 'active', ?, NULL)`,
      ).run(randomUUID(), input.taskId, input.toConversationId, now, input.toAgentId, assignmentEpoch, now);

      const snapshotId = randomUUID();
      db.prepare(
        `INSERT INTO task_handoff_snapshots (
          snapshot_id, task_id, from_conversation_id, to_conversation_id,
          from_agent_id, to_agent_id, assignment_epoch, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        snapshotId,
        input.taskId,
        current?.conversation_id ?? null,
        input.toConversationId,
        current?.agent_id ?? existing.current_executor_agent_id ?? null,
        input.toAgentId,
        assignmentEpoch,
        JSON.stringify(input.payload),
        now,
      );
      db.prepare(
        `UPDATE task_conversation_state SET
          active_conversation_id = ?, current_executor_agent_id = ?,
          assignment_epoch = ?, status = 'active', updated_at = ?
         WHERE task_id = ?`,
      ).run(input.toConversationId, input.toAgentId, assignmentEpoch, now, input.taskId);
      db.prepare(
        `INSERT INTO command_deduplication (
          idempotency_key, command_type, subject_kind, subject_id,
          request_hash, result_json, created_at
        ) VALUES (?, 'task.handoff', 'task', ?, ?, ?, ?)`,
      ).run(
        input.idempotencyKey,
        input.taskId,
        requestHash,
        JSON.stringify({ snapshotId }),
        now,
      );

      const state = stateFromRow(db.prepare(
        'SELECT * FROM task_conversation_state WHERE task_id = ?',
      ).get(input.taskId) as ConversationStateRow);
      return {
        state,
        taskVersion: input.expectedTaskVersion + 1,
        snapshot: {
          id: snapshotId,
          taskId: input.taskId,
          ...(current?.conversation_id ? { fromConversationId: current.conversation_id } : {}),
          toConversationId: input.toConversationId,
          ...(current?.agent_id || existing.current_executor_agent_id
            ? { fromAgentId: current?.agent_id ?? existing.current_executor_agent_id! }
            : {}),
          toAgentId: input.toAgentId,
          assignmentEpoch,
          payload: input.payload,
          createdAt: now,
        },
      };
    });
  }

  getLatestHandoff(taskId: string): TaskHandoffSnapshot | undefined {
    const row = getSqliteDatabase().prepare(
      `SELECT * FROM task_handoff_snapshots
       WHERE task_id = ? ORDER BY assignment_epoch DESC LIMIT 1`,
    ).get(taskId) as HandoffSnapshotRow | undefined;
    if (!row) return undefined;
    return snapshotFromRow(row);
  }
}
