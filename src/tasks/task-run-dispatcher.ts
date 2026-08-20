import { createLogger } from '../utils/logger.js';

import { TaskRepository } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';

const log = createLogger('TaskRunDispatcher');

export class TaskRunDispatcher {
  readonly #runs = new TaskRunRepository();
  readonly #tasks = new TaskRepository();
  readonly #draining = new Set<string>();

  constructor(private readonly deps: {
    workerId: string;
    ensureSession: (taskId: string, runId: string, agentId?: string) => Promise<string>;
    runAgent: (runId: string, sessionKey: string, message: string) => Promise<void>;
  }) {}

  dispatch(): void {
    void this.drain();
  }

  async drain(): Promise<void> {
    if (this.#draining.has(this.deps.workerId)) return;
    this.#draining.add(this.deps.workerId);
    try {
      while (true) {
        const run = this.#runs.claimNext({
          owner: this.deps.workerId,
          leaseMs: 60_000,
          executorKind: 'agent',
        });
        if (!run) return;
        const task = this.#tasks.get(run.taskId);
        if (!task) continue;
        try {
          const executableRun = run.status === 'waiting'
            ? this.#runs.setStatus({
              runId: run.id,
              expectedVersion: run.version,
              from: ['waiting'],
              to: 'running',
              actor: { kind: 'system', id: this.deps.workerId },
            })
            : run;
          if (!executableRun) continue;
          const agentId = typeof run.executorRef.agentId === 'string' ? run.executorRef.agentId : undefined;
          const sessionKey = await this.deps.ensureSession(task.id, run.id, agentId);
          await this.deps.runAgent(run.id, sessionKey, task.contract?.objective ?? task.title);
        } catch (error) {
          const current = this.#runs.get(run.id);
          if (current && ['queued', 'running', 'waiting', 'verifying'].includes(current.status)) {
            this.#runs.finalize({
              runId: current.id,
              expectedVersion: current.version,
              terminalCode: 'dispatch_failed',
              terminalMessage: error instanceof Error ? error.message : String(error),
              receipt: {
                status: 'failed',
                summary: 'TaskRun dispatch failed',
                changes: [],
                evidence: [],
                verification: { status: 'unverified', checks: [] },
                remainingWork: [task.contract?.objective ?? task.title],
                needsUser: false,
                completionVerdict: 'not_achieved',
                failure: { code: 'dispatch_failed', phase: 'dispatch', recoveryAction: 'Retry the task run' },
              },
            });
          }
          log.warn({ err: error, runId: run.id }, 'TaskRun dispatch attempt failed');
        }
      }
    } catch (error) {
      log.error({ err: error }, `TaskRun dispatch failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.#draining.delete(this.deps.workerId);
    }
  }
}
