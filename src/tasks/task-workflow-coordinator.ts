import type { WorkflowRunView } from '../workflows/domain/index.js';
import {
  completeExecutionReceipt,
  startExecutionReceipt,
  updateExecutionReceipt,
} from '../storage/sqlite/index.js';
import { TaskController, type TaskExecutionPort } from './task-controller.js';
import { TaskProjectionService } from './task-projection-service.js';
import { TaskRepository } from './task-repository.js';

export class TaskWorkflowCoordinator {
  readonly #tasks = new TaskRepository();
  readonly #projection = new TaskProjectionService();

  constructor(private readonly execution: TaskExecutionPort) {}

  handleTerminalRun(view: WorkflowRunView, sessionKey: string): void {
    const taskId = view.run.metadata?.taskId?.trim();
    if (!taskId) return;
    const task = this.#tasks.get(taskId);
    if (!task?.contract) return;
    const runId = `workflow:${view.run.id}`;
    const contract = {
      objective: task.contract.objective,
      expectedOutputs: task.contract.expectedOutputs,
      acceptanceCriteria: task.contract.acceptanceCriteria,
      constraints: task.contract.constraints,
      approvalRequired: task.contract.approvalRequired,
      assumptions: task.contract.assumptions,
      risks: task.contract.risks,
    };
    startExecutionReceipt({
      runId,
      sessionKey,
      channel: 'workflow',
      objective: task.objective,
      contract,
      contractVersion: task.contract.version,
      context: {
        taskId,
        projectId: view.run.metadata?.projectId,
        origin: 'workflow',
        triggerKind: 'user',
      },
    });
    updateExecutionReceipt({
      runId,
      evidence: [{
        kind: 'artifact',
        title: `Workflow ${view.run.definitionId} ${view.run.status}`,
        summary: view.run.result?.summary || view.run.error?.message || view.run.status,
        uri: `workflow:${view.run.id}`,
        provenance: 'tool',
        strength: 'observed',
        observedAt: Date.now(),
      }],
    });
    const receipt = completeExecutionReceipt({
      runId,
      status: view.run.status === 'succeeded' ? 'succeeded' : 'failed',
      summary: view.run.result?.summary || view.run.error?.message || `Workflow ${view.run.status}`,
    });
    if (!receipt) return;
    const projected = this.#projection.project(receipt);
    new TaskController(this.execution).handleCompletedRun(projected);
  }
}
