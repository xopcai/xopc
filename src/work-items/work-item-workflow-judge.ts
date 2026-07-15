import { renderWorkflowText } from '../agent/workflow/snapshot.js';
import type { WorkflowRunStatus, WorkflowRunView } from '../workflows/domain/index.js';
import { runViewToSnapshot } from '../workflows/service/run-view-to-snapshot.js';

import { WorkItemService } from './work-item-service.js';
import type { UpdateWorkItemInput } from './types.js';

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

    const existingSuggestion = this.workItems
      .listUpdateSuggestions(workItemId)
      .some((suggestion) => suggestion.sourceKind === 'workflow_run' && suggestion.sourceId === run.id);
    if (existingSuggestion) return;

    this.workItems.createUpdateSuggestion(workItemId, {
      sourceKind: 'workflow_run',
      sourceId: run.id,
      patch: buildWorkItemPatch(run.status, run.result?.followUps?.[0]?.prompt),
      progressNote: compactWorkflowText(input.view),
      rationale: `Workflow ${run.definitionId} finished with status ${run.status}.`,
      confidence: run.status === 'succeeded' ? 0.72 : 0.86,
    });
  }
}

function buildWorkItemPatch(status: WorkflowRunStatus, nextPrompt?: string): Pick<UpdateWorkItemInput, 'status' | 'nextAction' | 'blockedReason'> {
  if (status === 'succeeded') {
    return {
      status: 'in_review',
      blockedReason: null,
      ...(nextPrompt?.trim() ? { nextAction: nextPrompt.trim() } : {}),
    };
  }
  return {
    status: status === 'cancelled' ? 'needs_input' : 'blocked',
    blockedReason: `Workflow run ended with status ${status}.`,
    nextAction: 'Review the workflow run and decide the next action.',
  };
}

function compactWorkflowText(view: WorkflowRunView): string {
  const text = renderWorkflowText(
    runViewToSnapshot(view),
    view.run.status === 'succeeded',
    { showResultPreviews: true },
  ).trim();
  if (text.length <= 1800) return text;
  return `${text.slice(0, 1797)}...`;
}
