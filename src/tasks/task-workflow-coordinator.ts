import type { WorkflowRunView } from '../workflows/domain/index.js';
import { TaskApplicationService } from './task-application-service.js';
import { TaskRunRepository } from './task-run-repository.js';

export class TaskWorkflowCoordinator {
  readonly #runs = new TaskRunRepository();
  readonly #application = new TaskApplicationService();

  handleTerminalRun(view: WorkflowRunView): void {
    const taskRunId = view.run.metadata?.taskRunId?.trim();
    if (!taskRunId) return;
    const run = this.#runs.get(taskRunId);
    if (!run || !['running', 'waiting', 'verifying'].includes(run.status)) return;
    const succeeded = view.run.status === 'succeeded';
    const summary = view.run.result?.summary || view.run.error?.message || `Workflow ${view.run.status}`;
    const workflowId = typeof run.executorRef.workflowId === 'string'
      ? run.executorRef.workflowId
      : view.run.definitionId;
    this.#application.completeRun({
      runId: run.id,
      expectedRunVersion: run.version,
      terminalCode: succeeded ? undefined : 'workflow_failed',
      terminalMessage: succeeded ? undefined : summary,
      receipt: {
        status: succeeded ? 'succeeded' : 'failed',
        summary,
        changes: [],
        evidence: [{
          kind: 'artifact',
          title: `Workflow ${view.run.definitionId} ${view.run.status}`,
          summary,
          uri: `workflow:${view.run.id}`,
          provenance: 'tool',
          strength: 'observed',
          observedAt: Date.now(),
        }],
        verification: { status: 'unverified', checks: [] },
        remainingWork: succeeded ? [] : [workflowId],
        needsUser: false,
        completionVerdict: succeeded ? 'achieved' : 'not_achieved',
        ...(succeeded ? {} : {
          failure: { code: 'workflow_failed', phase: 'workflow', recoveryAction: 'Retry the TaskRun' },
        }),
      },
    });
  }
}
