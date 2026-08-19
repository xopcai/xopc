import { randomUUID } from 'node:crypto';

import type {
  Task,
  TaskContract,
  TaskPriority,
  TaskStatus,
} from '@xopcai/gateway-contract';

import { publishAutomationProductEvent } from '../automations/product-events.js';
import type { MediaRef } from '../media/types.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

export type TaskExecutionSource = 'chat' | 'cli' | 'cron' | 'workflow' | 'channel' | 'api';
export type TaskUiLocale = 'en' | 'zh';

export interface TaskRuntime {
  taskId: string;
  requestId?: string;
  agentId: string;
  priority: TaskPriority;
  activeSessionKey?: string;
  nextAction?: string;
  blockedReason?: string;
  uiLocale?: TaskUiLocale;
  source: TaskExecutionSource;
  projectId?: string;
  contextMessage?: { text: string; attachments: MediaRef[] };
  approvedBoundaries: string[];
  createdAt: number;
  updatedAt: number;
}

export type TaskAggregate = Task & { execution: TaskRuntime };

export type TaskSubjectKind =
  | 'project'
  | 'session'
  | 'workflow'
  | 'automation'
  | 'artifact'
  | 'source';

export type TaskLinkInput = {
  kind: TaskSubjectKind;
  id: string;
  relation?: string;
};

type TaskRow = {
  task_id: string;
  objective: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: number | null;
  latest_contract_version: number;
  latest_receipt_run_id: string | null;
  request_id: string | null;
  agent_id: string;
  active_session_key: string | null;
  next_action: string | null;
  blocked_reason: string | null;
  ui_locale: TaskUiLocale | null;
  source: TaskExecutionSource;
  project_id: string | null;
  context_text: string | null;
  context_attachments_json: string;
  approved_boundaries_json: string;
  created_at: number;
  updated_at: number;
};

type TaskContractRow = {
  task_id: string;
  version: number;
  objective: string;
  expected_outputs_json: string;
  acceptance_criteria_json: string;
  constraints_json: string;
  approval_required_json: string;
  assumptions_json: string;
  risks_json: string;
  context_snapshot_id: string | null;
  created_by: 'user' | 'system';
  created_at: number;
};

type TaskLinkRow = {
  subject_kind: TaskSubjectKind;
  subject_id: string;
  relation: string;
};

function contractFromRow(row: TaskContractRow): TaskContract {
  return {
    taskId: row.task_id,
    version: row.version,
    objective: row.objective,
    expectedOutputs: JSON.parse(row.expected_outputs_json) as string[],
    acceptanceCriteria: JSON.parse(row.acceptance_criteria_json) as string[],
    constraints: JSON.parse(row.constraints_json) as string[],
    approvalRequired: JSON.parse(row.approval_required_json) as string[],
    assumptions: JSON.parse(row.assumptions_json) as string[],
    risks: JSON.parse(row.risks_json) as string[],
    ...(row.context_snapshot_id ? { contextSnapshotId: row.context_snapshot_id } : {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function executionFromRow(row: TaskRow): TaskRuntime {
  const attachments = JSON.parse(row.context_attachments_json) as MediaRef[];
  return {
    taskId: row.task_id,
    ...(row.request_id ? { requestId: row.request_id } : {}),
    agentId: row.agent_id,
    priority: row.priority,
    ...(row.active_session_key ? { activeSessionKey: row.active_session_key } : {}),
    ...(row.next_action ? { nextAction: row.next_action } : {}),
    ...(row.blocked_reason ? { blockedReason: row.blocked_reason } : {}),
    ...(row.ui_locale ? { uiLocale: row.ui_locale } : {}),
    source: row.source,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...((row.context_text || attachments.length > 0)
      ? { contextMessage: { text: row.context_text ?? '', attachments } }
      : {}),
    approvedBoundaries: JSON.parse(row.approved_boundaries_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function taskFromRow(row: TaskRow, contract?: TaskContract): TaskAggregate {
  return {
    id: row.task_id,
    objective: row.objective,
    status: row.status,
    priority: row.priority,
    ...(row.due_at === null ? {} : { dueAt: row.due_at }),
    latestContractVersion: row.latest_contract_version,
    ...(row.latest_receipt_run_id ? { latestReceiptRunId: row.latest_receipt_run_id } : {}),
    ...(contract ? { contract } : {}),
    execution: executionFromRow(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class TaskRepository {
  create(input: {
    id?: string;
    objective: string;
    expectedOutputs?: string[];
    acceptanceCriteria?: string[];
    constraints?: string[];
    approvalRequired?: string[];
    assumptions?: string[];
    risks?: string[];
    contextSnapshotId?: string;
    createdBy?: 'user' | 'system';
    priority?: TaskPriority;
    dueAt?: number;
    links?: TaskLinkInput[];
    requestId?: string;
    agentId?: string;
    activeSessionKey?: string;
    uiLocale?: TaskUiLocale;
    source?: TaskExecutionSource;
    projectId?: string;
    contextText?: string;
    contextAttachments?: MediaRef[];
    approvedBoundaries?: string[];
    now?: number;
  }): TaskAggregate {
    const objective = input.objective.trim();
    if (!objective) throw new Error('Task objective is required');
    const id = input.id ?? randomUUID();
    const now = input.now ?? Date.now();
    runSqliteWriteTransaction((db) => {
      db.prepare(
        `INSERT INTO tasks (
          task_id, objective, status, priority,
          due_at, latest_contract_version, request_id, agent_id,
          active_session_key, ui_locale, source, project_id, context_text,
          context_attachments_json, approved_boundaries_json, created_at, updated_at
        ) VALUES (?, ?, 'pending', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        objective,
        input.priority ?? 'normal',
        input.dueAt ?? null,
        input.requestId ?? null,
        input.agentId ?? 'main',
        input.activeSessionKey ?? null,
        input.uiLocale ?? null,
        input.source ?? 'chat',
        input.projectId ?? null,
        input.contextText?.trim() || null,
        JSON.stringify(input.contextAttachments ?? []),
        JSON.stringify(input.approvedBoundaries ?? []),
        now,
        now,
      );
      db.prepare(
        `INSERT INTO task_contracts (
          task_id, version, objective, expected_outputs_json, acceptance_criteria_json,
          constraints_json, approval_required_json, context_snapshot_id, created_by, created_at
          , assumptions_json, risks_json
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        objective,
        JSON.stringify(input.expectedOutputs ?? []),
        JSON.stringify(input.acceptanceCriteria ?? []),
        JSON.stringify(input.constraints ?? []),
        JSON.stringify(input.approvalRequired ?? []),
        input.contextSnapshotId ?? null,
        input.createdBy ?? 'system',
        now,
        JSON.stringify(input.assumptions ?? []),
        JSON.stringify(input.risks ?? []),
      );
      for (const link of input.links ?? []) {
        this.addLink(id, link, now);
      }
    });
    const task = this.get(id)!;
    publishAutomationProductEvent({
      type: 'task.created',
      source: 'tasks',
      occurredAtMs: now,
      payload: {
        taskId: task.id,
        status: task.status,
        objective: task.objective,
        agentId: task.execution.agentId,
        projectId: task.execution.projectId,
      },
    });
    return task;
  }

  get(id: string): TaskAggregate | undefined {
    const row = getSqliteDatabase()
      .prepare('SELECT * FROM tasks WHERE task_id = ?')
      .get(id) as TaskRow | undefined;
    if (!row) return undefined;
    return taskFromRow(row, this.getContract(id, row.latest_contract_version));
  }

  getBySubject(kind: TaskSubjectKind, subjectId: string): TaskAggregate | undefined {
    const row = getSqliteDatabase().prepare(
      `SELECT tasks.* FROM tasks
       JOIN task_links ON task_links.task_id = tasks.task_id
       WHERE task_links.subject_kind = ? AND task_links.subject_id = ?
       ORDER BY tasks.updated_at DESC LIMIT 1`,
    ).get(kind, subjectId) as TaskRow | undefined;
    return row ? taskFromRow(row, this.getContract(row.task_id, row.latest_contract_version)) : undefined;
  }

  listLinks(taskId: string): TaskLinkInput[] {
    const rows = getSqliteDatabase().prepare(
      `SELECT subject_kind, subject_id, relation FROM task_links
       WHERE task_id = ? ORDER BY created_at ASC`,
    ).all(taskId) as TaskLinkRow[];
    return rows.map((row) => ({
      kind: row.subject_kind,
      id: row.subject_id,
      relation: row.relation,
    }));
  }

  list(input: { status?: TaskStatus; limit?: number } = {}): TaskAggregate[] {
    const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
    const rows = (input.status
      ? getSqliteDatabase().prepare(
        `SELECT * FROM tasks
         WHERE status = ?
         ORDER BY updated_at DESC LIMIT ?`,
      ).all(input.status, limit)
      : getSqliteDatabase().prepare(
        'SELECT * FROM tasks ORDER BY updated_at DESC LIMIT ?',
      ).all(limit)) as TaskRow[];
    return rows.map((row) => taskFromRow(
      row,
      this.getContract(row.task_id, row.latest_contract_version),
    ));
  }

  getContract(taskId: string, version?: number): TaskContract | undefined {
    const row = (version === undefined
      ? getSqliteDatabase().prepare(
        'SELECT * FROM task_contracts WHERE task_id = ? ORDER BY version DESC LIMIT 1',
      ).get(taskId)
      : getSqliteDatabase().prepare(
        'SELECT * FROM task_contracts WHERE task_id = ? AND version = ?',
      ).get(taskId, version)) as TaskContractRow | undefined;
    return row ? contractFromRow(row) : undefined;
  }

  reviseContract(input: {
    taskId: string;
    objective: string;
    expectedOutputs: string[];
    acceptanceCriteria: string[];
    constraints: string[];
    approvalRequired: string[];
    assumptions: string[];
    risks: string[];
    contextSnapshotId?: string;
    createdBy: 'user' | 'system';
    now?: number;
  }): TaskAggregate {
    const current = this.get(input.taskId);
    if (!current) throw new Error('Task not found');
    const objective = input.objective.trim();
    if (!objective) throw new Error('Task objective is required');
    const version = current.latestContractVersion + 1;
    const now = input.now ?? Date.now();
    runSqliteWriteTransaction((db) => {
      db.prepare(
        `INSERT INTO task_contracts (
          task_id, version, objective, expected_outputs_json, acceptance_criteria_json,
          constraints_json, approval_required_json, context_snapshot_id, created_by, created_at
          , assumptions_json, risks_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.taskId,
        version,
        objective,
        JSON.stringify(input.expectedOutputs),
        JSON.stringify(input.acceptanceCriteria),
        JSON.stringify(input.constraints),
        JSON.stringify(input.approvalRequired),
        input.contextSnapshotId ?? null,
        input.createdBy,
        now,
        JSON.stringify(input.assumptions),
        JSON.stringify(input.risks),
      );
      db.prepare(
        `UPDATE tasks SET objective = ?, latest_contract_version = ?, updated_at = ?
         WHERE task_id = ?`,
      ).run(objective, version, now, input.taskId);
    });
    return this.get(input.taskId)!;
  }

  getByRequestId(requestId: string): TaskAggregate | undefined {
    const row = getSqliteDatabase().prepare(
      'SELECT * FROM tasks WHERE request_id = ?',
    ).get(requestId) as TaskRow | undefined;
    return row ? taskFromRow(row, this.getContract(row.task_id, row.latest_contract_version)) : undefined;
  }

  getBySession(sessionKey: string): TaskAggregate | undefined {
    const row = getSqliteDatabase().prepare(
      `SELECT * FROM tasks WHERE active_session_key = ? ORDER BY updated_at DESC LIMIT 1`,
    ).get(sessionKey) as TaskRow | undefined;
    return row ? taskFromRow(row, this.getContract(row.task_id, row.latest_contract_version)) : undefined;
  }

  listByProject(projectId: string, limit = 50): TaskAggregate[] {
    const rows = getSqliteDatabase().prepare(
      `SELECT * FROM tasks WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?`,
    ).all(projectId, Math.max(1, Math.min(200, Math.floor(limit)))) as TaskRow[];
    return rows.map((row) => taskFromRow(
      row,
      this.getContract(row.task_id, row.latest_contract_version),
    ));
  }

  update(taskId: string, patch: {
    status?: TaskStatus;
    latestReceiptRunId?: string | null;
    activeSessionKey?: string | null;
    nextAction?: string | null;
    blockedReason?: string | null;
    contextText?: string | null;
    contextAttachments?: MediaRef[];
    approvedBoundaries?: string[];
    expectedUpdatedAt?: number;
    now?: number;
  }): TaskAggregate | undefined {
    const current = this.get(taskId);
    if (!current) return undefined;
    const execution = current.execution;
    const next = {
      activeSessionKey: patch.activeSessionKey === undefined ? execution.activeSessionKey : patch.activeSessionKey ?? undefined,
      nextAction: patch.nextAction === undefined ? execution.nextAction : patch.nextAction?.trim() || undefined,
      blockedReason: patch.blockedReason === undefined ? execution.blockedReason : patch.blockedReason?.trim() || undefined,
      contextText: patch.contextText === undefined ? execution.contextMessage?.text : patch.contextText?.trim() || undefined,
      contextAttachments: patch.contextAttachments ?? execution.contextMessage?.attachments ?? [],
      approvedBoundaries: patch.approvedBoundaries ?? execution.approvedBoundaries,
    };
    const now = Math.max(patch.now ?? Date.now(), current.updatedAt + 1);
    const result = getSqliteDatabase().prepare(
      `UPDATE tasks SET
        status = ?, latest_receipt_run_id = ?,
        active_session_key = ?, next_action = ?, blocked_reason = ?, context_text = ?,
        context_attachments_json = ?, approved_boundaries_json = ?, updated_at = ?
       WHERE task_id = ?${patch.expectedUpdatedAt === undefined ? '' : ' AND updated_at = ?'}`,
    ).run(
      patch.status ?? current.status,
      patch.latestReceiptRunId === undefined
        ? current.latestReceiptRunId ?? null
        : patch.latestReceiptRunId,
      next.activeSessionKey ?? null,
      next.nextAction ?? null,
      next.blockedReason ?? null,
      next.contextText ?? null,
      JSON.stringify(next.contextAttachments),
      JSON.stringify(next.approvedBoundaries),
      now,
      taskId,
      ...(patch.expectedUpdatedAt === undefined ? [] : [patch.expectedUpdatedAt]),
    );
    if (result.changes === 0) return undefined;
    const updated = this.get(taskId);
    if (updated && updated.status !== current.status) {
      publishAutomationProductEvent({
        type: 'task.status_changed',
        source: 'tasks',
        occurredAtMs: now,
        payload: {
          taskId,
          runId: updated.latestReceiptRunId ?? `${now}:${updated.status}`,
          status: updated.status,
          previousStatus: current.status,
          agentId: updated.execution.agentId,
          projectId: updated.execution.projectId,
          nextAction: updated.execution.nextAction,
          blockedReason: updated.execution.blockedReason,
        },
      });
    }
    return updated;
  }

  addLink(taskId: string, link: TaskLinkInput, now = Date.now()): void {
    getSqliteDatabase().prepare(
      `INSERT INTO task_links (task_id, subject_kind, subject_id, relation, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(task_id, subject_kind, subject_id)
       DO UPDATE SET relation = excluded.relation`,
    ).run(taskId, link.kind, link.id, link.relation ?? 'supports', now);
  }
}
