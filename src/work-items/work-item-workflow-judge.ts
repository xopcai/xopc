import type { WorkflowRunStatus, WorkflowRunView } from '../workflows/domain/index.js';

import { WorkItemService } from './work-item-service.js';

export interface WorkItemWorkflowJudgeInput {
  view: WorkflowRunView;
}

export class WorkItemWorkflowJudge {
  private readonly workItems = new WorkItemService();

  handleTerminalWorkflowRun(input: WorkItemWorkflowJudgeInput): void {
    const workItemId = input.view.run.metadata?.workItemId?.trim();
    if (!workItemId) return;

    const item = this.workItems.getWorkItem(workItemId);
    if (!item) return;

    const run = input.view.run;
    if (!item.links?.some((link) => link.kind === 'workflow_run' && link.targetId === run.id)) {
      this.workItems.addLink(workItemId, {
        kind: 'workflow_run',
        targetId: run.id,
        title: run.goal || run.title,
        statusSnapshot: run.status,
      });
    }

    const existingProposal = this.workItems
      .listCommandProposals(workItemId)
      .some((proposal) => proposal.sourceKind === 'workflow_run' && proposal.sourceId === run.id);
    if (existingProposal || run.status === 'cancelled') return;

    this.workItems.createCommandProposal(workItemId, {
      sourceKind: 'workflow_run',
      sourceId: run.id,
      command: buildWorkItemCommand(item, run.status, run.result?.followUps?.[0]?.prompt),
      rationale: `Workflow ${run.definitionId} finished with status ${run.status}.`,
      confidence: run.status === 'succeeded' ? 0.72 : 0.86,
    });
  }
}

function buildWorkItemCommand(
  item: NonNullable<ReturnType<WorkItemService['getWorkItem']>>,
  status: WorkflowRunStatus,
  nextPrompt?: string,
) {
  if (status === 'succeeded') {
    if (item.completionPolicy === 'user_accepted') {
      return { type: 'request_review' as const, expectedVersion: item.version, summary: compactText(nextPrompt, 'Review and accept the workflow result.') };
    }
    return { type: 'complete' as const, expectedVersion: item.version, summary: compactText(nextPrompt, 'Workflow completed successfully.') };
  }
  return {
    type: 'wait' as const,
    expectedVersion: item.version,
    wait: {
      kind: 'retry' as const,
      reason: `Workflow run ended with status ${status}.`,
      resumeAt: Date.now() + 5 * 60_000,
    },
  };
}

function compactText(value: string | undefined, fallback: string): string {
  const text = value?.trim() || fallback;
  return text.length <= 500 ? text : `${text.slice(0, 497)}...`;
}
