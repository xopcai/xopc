import { createHash, randomUUID } from 'node:crypto';

import type {
  ActorRef,
  TaskCommand,
  TaskChangedField,
  TaskCreateRequest,
  TaskExecutorSelection,
  TaskRunReceipt,
} from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import { TaskContextRepository } from './task-context-repository.js';
import { enqueueTaskAttentionRequiredEvent, enqueueTaskChangedEvent } from './task-change-events.js';
import { TaskDependencyService } from './task-dependency-service.js';
import { TaskReadModelProjector, type TaskReadModel } from './task-read-model-projector.js';
import { TaskRepository } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';

export type TaskApplicationResult =
  | { ok: true; model: TaskReadModel; runId?: string }
  | { ok: false; reason: 'not_found' | 'conflict' | 'invalid_transition' | 'blocked'; model?: TaskReadModel };

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function executorRef(executor: TaskExecutorSelection): Record<string, unknown> {
  switch (executor.kind) {
    case 'agent': return { agentId: executor.agentId };
    case 'workflow': return {
      workflowId: executor.workflowId,
      ...(executor.workflowVersion ? { workflowVersion: executor.workflowVersion } : {}),
      ...(executor.input === undefined ? {} : { input: executor.input }),
    };
    case 'human': return { actorId: executor.actorId };
    case 'external': return { provider: executor.provider, config: executor.config };
  }
}

function commandChangedFields(command: TaskCommand): TaskChangedField[] {
  switch (command.type) {
    case 'move':
    case 'mark_ready':
    case 'request_review':
    case 'close':
    case 'reopen':
      return ['phase', 'resolution', 'attention'];
    case 'start':
      return ['phase', 'runs', 'attention'];
    case 'add_wait':
    case 'resolve_wait':
      return ['runs', 'attention'];
    case 'revise_contract':
      return ['contract'];
  }
}

export class TaskApplicationService {
  readonly #tasks = new TaskRepository();
  readonly #runs = new TaskRunRepository();
  readonly #context = new TaskContextRepository();
  readonly #dependencies = new TaskDependencyService();
  readonly #projector = new TaskReadModelProjector();

  create(input: TaskCreateRequest, actor: ActorRef = { kind: 'user' }): TaskApplicationResult {
    const existing = this.#tasks.getByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      this.readCommand(input.idempotencyKey, requestHash(input));
      const model = this.#projector.project(existing);
      return { ok: true, model, ...(this.#runs.getActiveRoot(existing.id)
        ? { runId: this.#runs.getActiveRoot(existing.id)!.id }
        : {}) };
    }

    return runSqliteWriteTransaction((db) => {
      const task = this.#tasks.create({
        idempotencyKey: input.idempotencyKey,
        title: input.title,
        body: input.body,
        phase: input.activation.mode === 'capture' ? input.activation.phase : 'ready',
        projectId: input.projectId,
        milestoneId: input.milestoneId,
        parentTaskId: input.parentTaskId,
        priority: input.priority,
        dueAt: input.dueAt,
        ownerId: input.ownerId,
        delegateAgentId: input.delegateAgentId,
        source: 'api',
        locale: input.locale,
        ...input.contract,
        createdBy: actor,
      });
      db.prepare(
        `INSERT INTO task_conversation_state (
          task_id, active_session_key, current_executor_agent_id,
          assignment_epoch, status, updated_at
        ) VALUES (?, NULL, ?, 0, 'idle', ?)`,
      ).run(task.id, task.delegateAgentId ?? task.ownerId ?? null, task.createdAt);
      let current = task;
      if (input.dependencies.length > 0) {
        current = this.#dependencies.replace({
          taskId: task.id,
          dependsOnTaskIds: input.dependencies,
          expectedVersion: current.version,
        });
      }
      for (const edge of input.context) {
        this.#context.add({ taskId: task.id, ...edge, createdBy: actor });
      }
      for (const grant of input.authorityGrants) {
        this.#context.grant({ taskId: task.id, ...grant, grantedBy: actor });
      }
      this.recordCommand(db, {
        key: input.idempotencyKey,
        type: 'task.create',
        subjectId: task.id,
        hash: requestHash(input),
        result: { taskId: task.id },
      });
      this.enqueueEvent(db, 'task.created.v2', task.id, input.idempotencyKey, {
        taskId: task.id,
        phase: current.phase,
        projectId: current.projectId,
      });
      enqueueTaskChangedEvent(db, {
        taskId: current.id,
        projectId: current.projectId,
        version: current.version,
        changedFields: ['title', 'body', 'phase', 'priority', 'contract', 'dependencies', 'context'],
        actor,
      });

      if (input.activation.mode === 'capture') {
        return { ok: true, model: this.#projector.project(current) };
      }
      const executor = input.activation.executor
        ?? (current.delegateAgentId ? { kind: 'agent' as const, agentId: current.delegateAgentId } : undefined);
      if (!executor) throw new Error('Task start executor was not resolved');
      const started = this.start(current.id, current.version, executor, {
        idempotencyKey: `${input.idempotencyKey}:start`,
        scheduleAt: input.activation.scheduleAt,
        actor,
        correlationId: input.idempotencyKey,
      });
      if (started.ok) {
        enqueueTaskChangedEvent(db, {
          taskId: started.model.task.id,
          projectId: started.model.task.projectId,
          version: started.model.task.version,
          changedFields: ['phase', 'runs', 'attention'],
          actor,
        });
      } else if (started.ok === false && started.reason === 'blocked') {
        const waits = this.#runs.listActiveWaits(current.id);
        if (!waits.some((wait) => wait.kind === 'approval' || wait.kind === 'user_input')) {
          enqueueTaskAttentionRequiredEvent(db, {
            taskId: current.id,
            taskTitle: current.title,
            ...(current.projectId ? { projectId: current.projectId } : {}),
            reason: 'blocked',
            correlationId: input.idempotencyKey,
          });
        }
      }
      return started;
    });
  }

  execute(input: {
    taskId: string;
    idempotencyKey: string;
    expectedVersion: number;
    command: TaskCommand;
    actor?: ActorRef;
  }): TaskApplicationResult {
    const actor = input.actor ?? { kind: 'user' };
    const task = this.#tasks.get(input.taskId);
    if (!task) return { ok: false, reason: 'not_found' };
    const model = this.#projector.project(task);
    if (task.version !== input.expectedVersion) return { ok: false, reason: 'conflict', model };

    const duplicate = this.readCommand(input.idempotencyKey, requestHash(input.command));
    if (duplicate) return { ok: true, model };

    return runSqliteWriteTransaction((db) => {
      let result: TaskApplicationResult;
      switch (input.command.type) {
        case 'move':
          result = task.phase !== 'closed'
            && task.phase !== input.command.phase
            && !this.#runs.getActiveRoot(task.id)
            && this.#runs.listActiveWaits(task.id).length === 0
            ? this.lifecycle(task.id, task.version, input.command.phase)
            : { ok: false, reason: 'invalid_transition', model };
          break;
        case 'mark_ready':
          result = task.phase === 'backlog'
            ? this.lifecycle(task.id, task.version, 'ready')
            : { ok: false, reason: 'invalid_transition', model };
          break;
        case 'start':
          result = this.start(task.id, task.version, input.command.executor, {
            idempotencyKey: input.idempotencyKey,
            scheduleAt: input.command.scheduleAt,
            actor,
            correlationId: input.idempotencyKey,
          });
          break;
        case 'request_review':
          result = task.phase === 'active'
            ? this.lifecycle(task.id, task.version, 'review')
            : { ok: false, reason: 'invalid_transition', model };
          break;
        case 'close':
          result = this.lifecycle(task.id, task.version, 'closed', input.command.resolution);
          break;
        case 'reopen':
          result = task.phase === 'closed'
            ? this.lifecycle(task.id, task.version, input.command.phase)
            : { ok: false, reason: 'invalid_transition', model };
          break;
        case 'add_wait': {
          const activeRun = this.#runs.getActiveRoot(task.id);
          this.#runs.createWait({
            taskId: task.id,
            ...(activeRun ? { taskRunId: activeRun.id } : {}),
            actor,
            ...input.command.wait,
          });
          if (activeRun && (
            activeRun.status === 'queued'
            || activeRun.status === 'running'
            || activeRun.status === 'verifying'
          )) {
            this.#runs.setStatus({
              runId: activeRun.id,
              expectedVersion: activeRun.version,
              from: [activeRun.status],
              to: 'waiting',
              actor,
            });
          }
          result = { ok: true, model: this.#projector.get(task.id)! };
          break;
        }
        case 'resolve_wait': {
          const wait = this.#runs.getWait(input.command.waitId);
          if (!wait || wait.taskId !== task.id) {
            result = { ok: false, reason: 'not_found', model };
          } else {
            this.#runs.resolveWait({
              waitId: wait.id,
              actor,
              resolution: input.command.resolution,
            });
            result = { ok: true, model: this.#projector.get(task.id)! };
          }
          break;
        }
        case 'revise_contract': {
          const updated = this.#tasks.reviseContract({
            taskId: task.id,
            expectedVersion: task.version,
            ...input.command.contract,
            createdBy: actor,
          });
          result = updated
            ? { ok: true, model: this.#projector.project(updated) }
            : { ok: false, reason: 'conflict', model: this.#projector.get(task.id) };
          break;
        }
      }
      if (result.ok === false) {
        if (result.reason === 'blocked') {
          const waits = this.#runs.listActiveWaits(task.id);
          if (!waits.some((wait) => wait.kind === 'approval' || wait.kind === 'user_input')) {
            enqueueTaskAttentionRequiredEvent(db, {
              taskId: task.id,
              taskTitle: task.title,
              ...(task.projectId ? { projectId: task.projectId } : {}),
              reason: 'blocked',
              correlationId: input.idempotencyKey,
            });
          }
        }
        return result;
      }
      this.recordCommand(db, {
        key: input.idempotencyKey,
        type: `task.${input.command.type}`,
        subjectId: task.id,
        hash: requestHash(input.command),
        result: { taskId: task.id, runId: result.runId },
      });
      this.enqueueEvent(db, 'task.commanded.v2', task.id, input.idempotencyKey, {
        taskId: task.id,
        command: input.command.type,
        phase: result.model.task.phase,
        operationalState: result.model.operationalState,
        projectId: result.model.task.projectId,
        runId: result.runId,
      });
      if (result.model.task.phase !== task.phase) {
        this.enqueueEvent(db, 'task.phase_changed.v2', task.id, input.idempotencyKey, {
          task: { id: result.model.task.id, title: result.model.task.title },
          taskId: task.id,
          from: task.phase,
          to: result.model.task.phase,
          resolution: result.model.task.resolution,
          projectId: result.model.task.projectId,
        });
      }
      enqueueTaskChangedEvent(db, {
        taskId: result.model.task.id,
        projectId: result.model.task.projectId,
        version: result.model.task.version,
        changedFields: commandChangedFields(input.command),
        actor,
      });
      return result;
    });
  }

  completeRun(input: {
    runId: string;
    expectedRunVersion: number;
    receipt: Omit<TaskRunReceipt, 'runId' | 'finalizedAt'>;
    actor?: ActorRef;
    terminalCode?: string;
    terminalMessage?: string;
  }): TaskApplicationResult {
    return runSqliteWriteTransaction((db) => {
      const run = this.#runs.get(input.runId);
      if (!run) return { ok: false, reason: 'not_found' };
      if (run.version !== input.expectedRunVersion) {
        return { ok: false, reason: 'conflict', model: this.#projector.get(run.taskId) };
      }
      const finalized = this.#runs.finalize({
        runId: run.id,
        expectedVersion: run.version,
        receipt: input.receipt,
        actor: input.actor,
        terminalCode: input.terminalCode,
        terminalMessage: input.terminalMessage,
      });
      if (!finalized) {
        return { ok: false, reason: 'conflict', model: this.#projector.get(run.taskId) };
      }
      const task = this.#tasks.require(run.taskId);
      if (input.receipt.status !== 'succeeded') {
        const model = this.#projector.project(task);
        enqueueTaskAttentionRequiredEvent(db, {
          taskId: task.id,
          taskTitle: task.title,
          ...(task.projectId ? { projectId: task.projectId } : {}),
          reason: 'failed',
          detail: input.terminalMessage ?? input.receipt.summary,
          correlationId: run.id,
        });
        enqueueTaskChangedEvent(db, {
          taskId: task.id,
          projectId: task.projectId,
          version: task.version,
          changedFields: ['runs', 'receipts', 'attention'],
          actor: input.actor,
          source: input.actor ? undefined : 'runtime',
        });
        return { ok: true, model };
      }
      const verified = input.receipt.verification.status === 'passed';
      const phase = task.contract?.acceptancePolicy === 'verified_auto' && verified
        ? 'closed'
        : 'review';
      const updated = this.#tasks.setLifecycle({
        taskId: task.id,
        expectedVersion: task.version,
        phase,
        ...(phase === 'closed' ? { resolution: 'done' as const } : {}),
      });
      if (!updated) throw new Error('Task changed while its run was being finalized');
      this.enqueueEvent(db, 'task.phase_changed.v2', updated.id, run.id, {
        task: { id: updated.id, title: updated.title },
        taskId: updated.id,
        from: task.phase,
        to: updated.phase,
        resolution: updated.resolution,
        projectId: updated.projectId,
      });
      enqueueTaskChangedEvent(db, {
        taskId: updated.id,
        projectId: updated.projectId,
        version: updated.version,
        changedFields: ['phase', 'resolution', 'runs', 'receipts', 'attention'],
        actor: input.actor,
        source: input.actor ? undefined : 'runtime',
      });
      return { ok: true, model: this.#projector.project(updated) };
    });
  }

  private start(
    taskId: string,
    expectedVersion: number,
    executor: TaskExecutorSelection,
    options: {
      idempotencyKey: string;
      scheduleAt?: number;
      actor: ActorRef;
      correlationId: string;
    },
  ): TaskApplicationResult {
    const task = this.#tasks.get(taskId);
    if (!task || task.version !== expectedVersion) {
      return task
        ? { ok: false, reason: 'conflict', model: this.#projector.project(task) }
        : { ok: false, reason: 'not_found' };
    }
    if (task.phase === 'closed' || this.#runs.getActiveRoot(taskId)) {
      return { ok: false, reason: 'invalid_transition', model: this.#projector.project(task) };
    }

    const blocking = this.#dependencies.listBlocking(taskId);
    if (blocking.length > 0) {
      const existingWaits = this.#runs.listActiveWaits(taskId);
      for (const dependency of blocking) {
        if (existingWaits.some((wait) =>
          wait.kind === 'dependency' && wait.condition.dependsOnTaskId === dependency.id)) continue;
        this.#runs.createWait({
          taskId,
          kind: 'dependency',
          reason: `Waiting for ${dependency.title}`,
          condition: { dependsOnTaskId: dependency.id, executor },
        });
      }
      return { ok: false, reason: 'blocked', model: this.#projector.get(taskId)! };
    }

    const granted = new Set(this.#context.listActiveGrants(taskId).map((grant) => grant.capability));
    const missing = (task.contract?.approvalRequired ?? []).filter((boundary) => !granted.has(boundary));
    if (missing.length > 0) {
      for (const capability of missing) {
        this.#runs.createWait({
          taskId,
          kind: 'approval',
          reason: `Approval required: ${capability}`,
          condition: { capability, executor },
        });
      }
      return { ok: false, reason: 'blocked', model: this.#projector.get(taskId)! };
    }

    const run = this.#runs.create({
      taskId,
      executorKind: executor.kind,
      executorRef: executorRef(executor),
      trigger: {
        kind: options.actor.kind === 'user'
          ? 'user'
          : options.actor.id === 'task-signal'
            ? 'signal'
            : options.actor.kind,
        actor: options.actor,
      },
      correlationId: options.correlationId,
      idempotencyKey: options.idempotencyKey,
      contractVersion: task.latestContractVersion,
      scheduledAt: options.scheduleAt,
      retryPolicy: { maxAttempts: 3 },
    });
    const active = task.phase === 'active'
      ? task
      : this.#tasks.setLifecycle({
        taskId,
        expectedVersion: task.version,
        phase: 'active',
      });
    if (!active) throw new Error('Task changed while its run was being created');
    return { ok: true, model: this.#projector.project(active), runId: run.id };
  }

  private lifecycle(
    taskId: string,
    expectedVersion: number,
    phase: Parameters<TaskRepository['setLifecycle']>[0]['phase'],
    resolution?: Parameters<TaskRepository['setLifecycle']>[0]['resolution'],
  ): TaskApplicationResult {
    const updated = this.#tasks.setLifecycle({ taskId, expectedVersion, phase, resolution });
    return updated
      ? { ok: true, model: this.#projector.project(updated) }
      : { ok: false, reason: 'conflict', model: this.#projector.get(taskId) };
  }

  private recordCommand(
    db: ReturnType<typeof getSqliteDatabase>,
    input: { key: string; type: string; subjectId: string; hash: string; result: unknown },
  ): void {
    db.prepare(
      `INSERT INTO command_deduplication (
        idempotency_key, command_type, subject_kind, subject_id,
        request_hash, result_json, created_at
      ) VALUES (?, ?, 'task', ?, ?, ?, ?)`,
    ).run(
      input.key,
      input.type,
      input.subjectId,
      input.hash,
      JSON.stringify(input.result),
      Date.now(),
    );
  }

  private readCommand(key: string, hash: string): boolean {
    const row = getSqliteDatabase().prepare(
      `SELECT request_hash FROM command_deduplication WHERE idempotency_key = ?`,
    ).get(key) as { request_hash: string } | undefined;
    if (!row) return false;
    if (row.request_hash !== hash) throw new Error('Idempotency key was reused with different input');
    return true;
  }

  private enqueueEvent(
    db: ReturnType<typeof getSqliteDatabase>,
    eventType: string,
    subjectId: string,
    correlationId: string,
    payload: unknown,
  ): void {
    db.prepare(
      `INSERT INTO domain_outbox (
        event_id, event_type, subject_kind, subject_id, correlation_id,
        payload_json, created_at
      ) VALUES (?, ?, 'task', ?, ?, ?, ?)`,
    ).run(randomUUID(), eventType, subjectId, correlationId, JSON.stringify(payload), Date.now());
  }
}
