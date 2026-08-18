import type { WorkflowRunView } from '../workflows/domain/index.js';
import {
  completeExecutionReceipt,
  startExecutionReceipt,
  updateExecutionReceipt,
} from '../storage/sqlite/index.js';
import { OutcomeController, type OutcomeExecutionPort } from './outcome-controller.js';
import { OutcomeProjectionService } from './outcome-projection-service.js';
import { OutcomeRepository } from './outcome-repository.js';

export class OutcomeWorkflowCoordinator {
  readonly #outcomes = new OutcomeRepository();
  readonly #projection = new OutcomeProjectionService();

  constructor(private readonly execution: OutcomeExecutionPort) {}

  handleTerminalRun(view: WorkflowRunView, sessionKey: string): void {
    const outcomeId = view.run.metadata?.outcomeId?.trim();
    if (!outcomeId) return;
    const outcome = this.#outcomes.get(outcomeId);
    if (!outcome?.contract) return;
    const runId = `workflow:${view.run.id}`;
    const contract = {
      objective: outcome.contract.objective,
      deliverables: outcome.contract.deliverables,
      acceptanceCriteria: outcome.contract.acceptanceCriteria,
      constraints: outcome.contract.constraints,
      approvalRequired: outcome.contract.approvalRequired,
      assumptions: outcome.contract.assumptions,
      risks: outcome.contract.risks,
    };
    startExecutionReceipt({
      runId,
      sessionKey,
      channel: 'workflow',
      objective: outcome.objective,
      contract,
      contractVersion: outcome.contract.version,
      context: {
        outcomeId,
        projectId: view.run.metadata?.projectId,
        workItemId: view.run.metadata?.workItemId,
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
    new OutcomeController(this.execution).handleCompletedRun(projected);
  }
}
