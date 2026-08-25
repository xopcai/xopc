import type { TaskEvidence, TaskRunReceipt } from '@xopcai/gateway-contract';

import type { ExecutionContext } from './execution-context.js';
import { TaskApplicationService } from './task-application-service.js';
import { TaskContextRepository } from './task-context-repository.js';
import { TaskRepository } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';

export class TaskRunCoordinator {
  readonly #evidence: TaskEvidence[] = [];
  readonly #application = new TaskApplicationService();
  readonly #runs = new TaskRunRepository();

  private constructor(readonly runId: string) {}

  static start(input: {
    runId: string;
    context: ExecutionContext;
    fallbackObjective: string;
  }): TaskRunCoordinator | undefined {
    if (!input.context.taskId) return undefined;
    const tasks = new TaskRepository();
    const task = tasks.get(input.context.taskId);
    if (!task || task.phase === 'closed') return undefined;
    const runs = new TaskRunRepository();
    let run = runs.get(input.runId);
    if (!run) {
      if (runs.getActiveRoot(task.id)) return undefined;
      const agentId = task.delegateAgentId ?? input.context.agentId;
      if (!agentId) return undefined;
      run = runs.create({
        id: input.runId,
        taskId: task.id,
        executorKind: 'agent',
        executorRef: { agentId },
        trigger: { kind: input.context.triggerKind },
        correlationId: input.runId,
        idempotencyKey: input.runId,
        contractVersion: task.latestContractVersion,
        sessionKey: input.context.sessionKey,
      });
      if (task.phase !== 'active') {
        tasks.setLifecycle({ taskId: task.id, expectedVersion: task.version, phase: 'active' });
      }
    }
    if (run.status === 'queued') {
      const context = new TaskContextRepository();
      const snapshot = context.captureSnapshot({
        ownerKind: 'task_run',
        ownerId: run.id,
        sessionKey: input.context.sessionKey,
        query: task.contract?.objective ?? input.fallbackObjective,
        selectedItems: context.list(task.id),
        authorizationSnapshot: { grants: context.listActiveGrants(task.id) },
      });
      run = runs.start({
        runId: run.id,
        expectedVersion: run.version,
        contextSnapshotId: snapshot.id,
        policySnapshot: { executorKind: 'agent' },
        sessionKey: input.context.sessionKey,
      }) ?? run;
    }
    return run.status === 'running' ? new TaskRunCoordinator(run.id) : undefined;
  }

  addEvidence(evidence: TaskEvidence): void {
    if (this.#evidence.some((item) => item.kind === evidence.kind && item.title === evidence.title)) return;
    this.#evidence.push(evidence);
  }

  capturePlan(items: Array<{ title: string; status: string }>): void {
    for (const item of items) {
      if (item.status !== 'completed') continue;
      this.addEvidence({ kind: 'state', title: `Plan item completed: ${item.title}`,
        summary: 'The agent completed this plan item.', provenance: 'tool', strength: 'observed', observedAt: Date.now() });
    }
  }

  capturePatch(added: number, removed: number): void {
    this.addEvidence({ kind: 'state', title: 'Changes applied', summary: `${added} additions and ${removed} removals`,
      provenance: 'tool', strength: 'observed', observedAt: Date.now() });
  }

  captureCommand(command: string, durationMs?: number): void {
    if (!/(^|\s)(test|vitest|jest|pytest|lint|typecheck|build)(\s|$|:)/i.test(command)) return;
    this.addEvidence({ kind: 'test', title: command.slice(0, 120),
      summary: durationMs === undefined ? 'Command completed successfully' : `Command completed successfully in ${durationMs} ms`,
      provenance: 'tool', strength: 'verified', observedAt: Date.now() });
  }

  finalize(input: { status: TaskRunReceipt['status']; summary: string }): void {
    const run = this.#runs.get(this.runId);
    if (!run || !['running', 'waiting', 'verifying'].includes(run.status)) return;
    if (run.status === 'waiting' && this.#runs.listActiveWaits(run.taskId).length > 0) return;
    this.#application.completeRun({
      runId: run.id,
      expectedRunVersion: run.version,
      receipt: {
        status: input.status,
        summary: input.summary,
        changes: this.#evidence.filter((item) => item.kind === 'state'),
        evidence: this.#evidence,
        verification: { status: 'unverified', checks: [] },
        remainingWork: [],
        needsUser: false,
        completionVerdict: input.status === 'succeeded' ? 'achieved' : 'not_achieved',
        ...(input.status === 'failed' ? { failure: { code: 'agent_run_failed', phase: 'execution', recoveryAction: 'Retry the task run' } } : {}),
      },
    });
  }
}
