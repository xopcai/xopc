import { TaskRunCancelInputSchema, TaskRunCancelOutputSchema, TaskRunFeedbackInputSchema, TaskRunFeedbackOutputSchema } from '@xopcai/gateway-contract';

import { CapabilityError, defineAtomicCapability, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import { TaskApplicationService } from '../task-application-service.js';
import { TaskRepository } from '../task-repository.js';
import { TaskRunRepository } from '../task-run-repository.js';

export function registerTaskRunWriteCapabilities(dispatcher: CapabilityDispatcher, wake?: (runs: boolean) => void): void {
  dispatcher.register(defineAtomicCapability({
    id: 'xopc.task_runs.feedback', majorVersion: 1, description: 'Record feedback for one task run exactly once per intent.',
    effect: 'local-write', surfaces: ['http', 'agent'], scopes: ['tasks.write'],
    input: TaskRunFeedbackInputSchema, output: TaskRunFeedbackOutputSchema,
    execute({ id, rating, reason }, context) {
      const runs = new TaskRunRepository();
      if (!runs.get(id)) throw new CapabilityError('NOT_FOUND', 'TaskRun not found');
      return { ok: true as const, feedback: runs.recordFeedback({ runId: id, rating, reason, actor: context.actor }) };
    },
    afterCommit() { wake?.(false); },
  }));
  dispatcher.register(defineAtomicCapability({
    id: 'xopc.task_runs.cancel', majorVersion: 1,
    description: 'Finalize a task run as logically cancelled at an exact version. This receipt does not confirm external execution has stopped.',
    effect: 'local-write', surfaces: ['http', 'agent'], scopes: ['tasks.write'],
    input: TaskRunCancelInputSchema, output: TaskRunCancelOutputSchema,
    execute({ id, expectedVersion, reason }, context) {
      const runs = new TaskRunRepository();
      const run = runs.get(id);
      if (!run) throw new CapabilityError('NOT_FOUND', 'TaskRun not found');
      if (run.version !== expectedVersion) throw new CapabilityError('REVISION_CONFLICT', 'TaskRun changed');
      const task = new TaskRepository().require(run.taskId);
      const result = new TaskApplicationService().completeRun({
        runId: id, expectedRunVersion: expectedVersion, actor: context.actor,
        terminalCode: context.actor?.kind === 'agent' ? 'cancelled_by_agent' : 'cancelled_by_user', terminalMessage: reason,
        receipt: { status: 'cancelled', summary: reason, changes: [], evidence: [],
          verification: { status: 'unverified', checks: [] }, remainingWork: [task.contract?.objective ?? task.title],
          needsUser: false, completionVerdict: 'not_achieved' },
      });
      if (!result.ok) throw new CapabilityError('REVISION_CONFLICT', 'TaskRun cannot be cancelled in its current state');
      return { ok: true as const, run: runs.require(id), receipt: runs.getReceipt(id)!, model: result.model, executionStopConfirmed: false as const };
    },
    afterCommit() { wake?.(false); },
  }));
}
