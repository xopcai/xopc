import { randomUUID } from 'node:crypto';

import type {
  ActorRef,
  Task,
  TaskAcceptancePolicy,
  TaskContract,
  TaskPhase,
  TaskPriority,
  TaskResolution,
} from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

export type TaskExecutionSource = 'chat' | 'cli' | 'cron' | 'workflow' | 'channel' | 'api';
export type TaskUiLocale = 'en' | 'zh';
export type TaskAggregate = Task;

type TaskRow = {
  task_id: string;
  creation_idempotency_key: string | null;
  project_id: string | null;
  milestone_id: string | null;
  parent_task_id: string | null;
  title: string;
  body: string | null;
  phase: TaskPhase;
  resolution: TaskResolution | null;
  priority: TaskPriority;
  due_at: number | null;
  owner_id: string | null;
  delegate_agent_id: string | null;
  source: string;
  locale: TaskUiLocale | null;
  latest_contract_version: number;
  version: number;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
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
  acceptance_policy: TaskAcceptancePolicy;
  output_destinations_json: string;
  created_by_json: string;
  created_at: number;
};

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function contractFromRow(row: TaskContractRow): TaskContract {
  return {
    taskId: row.task_id,
    version: row.version,
    objective: row.objective,
    expectedOutputs: parseJson<string[]>(row.expected_outputs_json),
    acceptanceCriteria: parseJson<string[]>(row.acceptance_criteria_json),
    constraints: parseJson<string[]>(row.constraints_json),
    approvalRequired: parseJson<string[]>(row.approval_required_json),
    assumptions: parseJson<string[]>(row.assumptions_json),
    risks: parseJson<string[]>(row.risks_json),
    acceptancePolicy: row.acceptance_policy,
    outputDestinations: parseJson<Array<Record<string, unknown>>>(row.output_destinations_json),
    createdBy: parseJson<ActorRef>(row.created_by_json),
    createdAt: row.created_at,
  };
}

function taskFromRow(row: TaskRow, contract?: TaskContract): TaskAggregate {
  return {
    id: row.task_id,
    title: row.title,
    ...(row.body ? { body: row.body } : {}),
    phase: row.phase,
    ...(row.resolution ? { resolution: row.resolution } : {}),
    priority: row.priority,
    ...(row.due_at === null ? {} : { dueAt: row.due_at }),
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.milestone_id ? { milestoneId: row.milestone_id } : {}),
    ...(row.parent_task_id ? { parentTaskId: row.parent_task_id } : {}),
    ...(row.owner_id ? { ownerId: row.owner_id } : {}),
    ...(row.delegate_agent_id ? { delegateAgentId: row.delegate_agent_id } : {}),
    source: row.source,
    ...(row.locale ? { locale: row.locale } : {}),
    latestContractVersion: row.latest_contract_version,
    version: row.version,
    ...(contract ? { contract } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.closed_at === null ? {} : { closedAt: row.closed_at }),
  };
}

export interface TaskCreateInput {
  id?: string;
  idempotencyKey?: string;
  title: string;
  body?: string;
  phase?: Extract<TaskPhase, 'backlog' | 'ready'>;
  projectId?: string;
  milestoneId?: string;
  parentTaskId?: string;
  priority?: TaskPriority;
  dueAt?: number;
  ownerId?: string;
  delegateAgentId?: string;
  source?: TaskExecutionSource;
  locale?: TaskUiLocale;
  objective: string;
  expectedOutputs?: string[];
  acceptanceCriteria?: string[];
  constraints?: string[];
  approvalRequired?: string[];
  assumptions?: string[];
  risks?: string[];
  acceptancePolicy?: TaskAcceptancePolicy;
  outputDestinations?: Array<Record<string, unknown>>;
  createdBy?: ActorRef;
  now?: number;
}

export class TaskRepository {
  create(input: TaskCreateInput): TaskAggregate {
    const title = input.title.trim();
    const objective = input.objective.trim();
    if (!title) throw new Error('Task title is required');
    if (!objective) throw new Error('Task objective is required');
    const id = input.id ?? randomUUID();
    const now = input.now ?? Date.now();
    runSqliteWriteTransaction((db) => {
      db.prepare(
        `INSERT INTO tasks (
          task_id, creation_idempotency_key, project_id, milestone_id, parent_task_id,
          title, body, phase, priority, due_at, owner_id, delegate_agent_id,
          source, locale, latest_contract_version, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      ).run(
        id,
        input.idempotencyKey ?? null,
        input.projectId ?? null,
        input.milestoneId ?? null,
        input.parentTaskId ?? null,
        title,
        input.body?.trim() || null,
        input.phase ?? 'backlog',
        input.priority ?? 'normal',
        input.dueAt ?? null,
        input.ownerId ?? null,
        input.delegateAgentId ?? null,
        input.source ?? 'api',
        input.locale ?? null,
        now,
        now,
      );
      this.insertContract(db, {
        taskId: id,
        version: 1,
        objective,
        expectedOutputs: input.expectedOutputs ?? [],
        acceptanceCriteria: input.acceptanceCriteria ?? [],
        constraints: input.constraints ?? [],
        approvalRequired: input.approvalRequired ?? [],
        assumptions: input.assumptions ?? [],
        risks: input.risks ?? [],
        acceptancePolicy: input.acceptancePolicy ?? 'verified_then_review',
        outputDestinations: input.outputDestinations ?? [],
        createdBy: input.createdBy ?? { kind: 'system' },
        createdAt: now,
      });
    });
    return this.require(id);
  }

  get(id: string): TaskAggregate | undefined {
    const row = getSqliteDatabase().prepare(
      'SELECT * FROM tasks WHERE task_id = ?',
    ).get(id) as TaskRow | undefined;
    return row ? taskFromRow(row, this.getContract(id, row.latest_contract_version)) : undefined;
  }

  require(id: string): TaskAggregate {
    const task = this.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    return task;
  }

  getByIdempotencyKey(key: string): TaskAggregate | undefined {
    const row = getSqliteDatabase().prepare(
      'SELECT * FROM tasks WHERE creation_idempotency_key = ?',
    ).get(key) as TaskRow | undefined;
    return row ? taskFromRow(row, this.getContract(row.task_id, row.latest_contract_version)) : undefined;
  }

  getBySession(sessionKey: string): TaskAggregate | undefined {
    const row = getSqliteDatabase().prepare(
      `SELECT tasks.* FROM tasks
       JOIN task_sessions ON task_sessions.task_id = tasks.task_id
       WHERE task_sessions.session_key = ?
       ORDER BY task_sessions.created_at DESC LIMIT 1`,
    ).get(sessionKey) as TaskRow | undefined;
    return row ? taskFromRow(row, this.getContract(row.task_id, row.latest_contract_version)) : undefined;
  }

  list(input: { phase?: TaskPhase; projectId?: string; limit?: number } = {}): TaskAggregate[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (input.phase) {
      clauses.push('phase = ?');
      params.push(input.phase);
    }
    if (input.projectId) {
      clauses.push('project_id = ?');
      params.push(input.projectId);
    }
    const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
    params.push(limit);
    const rows = getSqliteDatabase().prepare(
      `SELECT * FROM tasks${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY updated_at DESC LIMIT ?`,
    ).all(...params) as TaskRow[];
    return rows.map((row) => taskFromRow(
      row,
      this.getContract(row.task_id, row.latest_contract_version),
    ));
  }

  listByProject(projectId: string, limit = 50): TaskAggregate[] {
    return this.list({ projectId, limit });
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

  update(taskId: string, patch: {
    expectedVersion: number;
    title?: string;
    body?: string | null;
    projectId?: string | null;
    milestoneId?: string | null;
    parentTaskId?: string | null;
    priority?: TaskPriority;
    dueAt?: number | null;
    ownerId?: string | null;
    delegateAgentId?: string | null;
    now?: number;
  }): TaskAggregate | undefined {
    const current = this.get(taskId);
    if (!current || current.version !== patch.expectedVersion) return undefined;
    const title = patch.title === undefined ? current.title : patch.title.trim();
    if (!title) throw new Error('Task title is required');
    const now = Math.max(patch.now ?? Date.now(), current.updatedAt + 1);
    const result = getSqliteDatabase().prepare(
      `UPDATE tasks SET title = ?, body = ?, project_id = ?, milestone_id = ?,
       parent_task_id = ?, priority = ?, due_at = ?, owner_id = ?, delegate_agent_id = ?,
       version = version + 1, updated_at = ?
       WHERE task_id = ? AND version = ?`,
    ).run(
      title,
      patch.body === undefined ? current.body ?? null : patch.body?.trim() || null,
      patch.projectId === undefined ? current.projectId ?? null : patch.projectId,
      patch.milestoneId === undefined ? current.milestoneId ?? null : patch.milestoneId,
      patch.parentTaskId === undefined ? current.parentTaskId ?? null : patch.parentTaskId,
      patch.priority ?? current.priority,
      patch.dueAt === undefined ? current.dueAt ?? null : patch.dueAt,
      patch.ownerId === undefined ? current.ownerId ?? null : patch.ownerId,
      patch.delegateAgentId === undefined ? current.delegateAgentId ?? null : patch.delegateAgentId,
      now,
      taskId,
      patch.expectedVersion,
    );
    return result.changes === 0 ? undefined : this.get(taskId);
  }

  setLifecycle(input: {
    taskId: string;
    expectedVersion: number;
    phase: TaskPhase;
    resolution?: TaskResolution;
    now?: number;
  }): TaskAggregate | undefined {
    if ((input.phase === 'closed') !== Boolean(input.resolution)) {
      throw new Error('Closed tasks require a resolution and open tasks cannot have one');
    }
    const current = this.get(input.taskId);
    if (!current || current.version !== input.expectedVersion) return undefined;
    const now = Math.max(input.now ?? Date.now(), current.updatedAt + 1);
    const result = getSqliteDatabase().prepare(
      `UPDATE tasks SET phase = ?, resolution = ?, closed_at = ?,
       version = version + 1, updated_at = ?
       WHERE task_id = ? AND version = ?`,
    ).run(
      input.phase,
      input.resolution ?? null,
      input.phase === 'closed' ? now : null,
      now,
      input.taskId,
      input.expectedVersion,
    );
    return result.changes === 0 ? undefined : this.get(input.taskId);
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
    acceptancePolicy: TaskAcceptancePolicy;
    outputDestinations: Array<Record<string, unknown>>;
    createdBy: ActorRef;
    expectedVersion: number;
    now?: number;
  }): TaskAggregate | undefined {
    const current = this.get(input.taskId);
    if (!current || current.version !== input.expectedVersion) return undefined;
    const objective = input.objective.trim();
    if (!objective) throw new Error('Task objective is required');
    const now = Math.max(input.now ?? Date.now(), current.updatedAt + 1);
    const contractVersion = current.latestContractVersion + 1;
    return runSqliteWriteTransaction((db) => {
      this.insertContract(db, {
        taskId: input.taskId,
        version: contractVersion,
        objective,
        expectedOutputs: input.expectedOutputs,
        acceptanceCriteria: input.acceptanceCriteria,
        constraints: input.constraints,
        approvalRequired: input.approvalRequired,
        assumptions: input.assumptions,
        risks: input.risks,
        acceptancePolicy: input.acceptancePolicy,
        outputDestinations: input.outputDestinations,
        createdBy: input.createdBy,
        createdAt: now,
      });
      const result = db.prepare(
        `UPDATE tasks SET latest_contract_version = ?, version = version + 1, updated_at = ?
         WHERE task_id = ? AND version = ?`,
      ).run(contractVersion, now, input.taskId, input.expectedVersion);
      return result.changes === 0 ? undefined : this.get(input.taskId);
    });
  }

  delete(taskId: string): boolean {
    return getSqliteDatabase().prepare('DELETE FROM tasks WHERE task_id = ?').run(taskId).changes > 0;
  }

  private insertContract(db: ReturnType<typeof getSqliteDatabase>, contract: TaskContract): void {
    db.prepare(
      `INSERT INTO task_contracts (
        task_id, version, objective, expected_outputs_json, acceptance_criteria_json,
        constraints_json, approval_required_json, assumptions_json, risks_json,
        acceptance_policy, output_destinations_json, created_by_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      contract.taskId,
      contract.version,
      contract.objective,
      JSON.stringify(contract.expectedOutputs),
      JSON.stringify(contract.acceptanceCriteria),
      JSON.stringify(contract.constraints),
      JSON.stringify(contract.approvalRequired),
      JSON.stringify(contract.assumptions),
      JSON.stringify(contract.risks),
      contract.acceptancePolicy,
      JSON.stringify(contract.outputDestinations),
      JSON.stringify(contract.createdBy),
      contract.createdAt,
    );
  }
}
