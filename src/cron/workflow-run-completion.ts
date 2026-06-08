import { renderWorkflowText } from '../agent/workflow/snapshot.js';
import type { WorkflowRunView } from '../workflows/domain/index.js';
import { isTerminalWorkflowRunStatus } from '../workflows/domain/index.js';
import { runViewToSnapshot } from '../workflows/service/run-view-to-snapshot.js';

/** Default wait budget for cron workflow runs (35 minutes). */
export const DEFAULT_WORKFLOW_CRON_WAIT_MS = 35 * 60 * 1000;
export const WORKFLOW_CRON_POLL_MS = 3000;

export function resolveWorkflowCronWaitMs(jobTimeoutMs: number | undefined): number {
  const configured = jobTimeoutMs && Number.isFinite(jobTimeoutMs) ? jobTimeoutMs : 0;
  return Math.max(configured, DEFAULT_WORKFLOW_CRON_WAIT_MS);
}

export async function waitForWorkflowRunView(params: {
  readView: (runId: string) => Promise<WorkflowRunView | null>;
  runId: string;
  signal: AbortSignal;
  timeoutMs: number;
  pollIntervalMs?: number;
}): Promise<
  | { kind: 'terminal'; view: WorkflowRunView }
  | { kind: 'timeout'; lastView: WorkflowRunView | null }
  | { kind: 'aborted' }
> {
  const pollIntervalMs = params.pollIntervalMs ?? WORKFLOW_CRON_POLL_MS;
  const deadline = Date.now() + params.timeoutMs;
  let lastView: WorkflowRunView | null = null;

  while (Date.now() < deadline) {
    if (params.signal.aborted) {
      return { kind: 'aborted' };
    }

    const view = await params.readView(params.runId);
    if (view) {
      lastView = view;
      if (isTerminalWorkflowRunStatus(view.run.status)) {
        return { kind: 'terminal', view };
      }
    }

    await sleep(pollIntervalMs, params.signal);
  }

  return { kind: 'timeout', lastView };
}

export function buildWorkflowRunCronSummary(view: WorkflowRunView): string {
  const status = view.run.status;
  const label = view.run.goal.trim() || view.run.definitionId;
  if (status === 'succeeded') {
    return `Workflow ${view.run.definitionId} succeeded: ${label}`;
  }
  if (status === 'failed') {
    const detail = view.run.error?.message?.trim();
    return detail
      ? `Workflow ${view.run.definitionId} failed: ${detail}`
      : `Workflow ${view.run.definitionId} failed`;
  }
  if (status === 'timeout') {
    return `Workflow ${view.run.definitionId} timed out`;
  }
  if (status === 'cancelled') {
    return `Workflow ${view.run.definitionId} cancelled`;
  }
  return `Workflow ${view.run.definitionId} finished (${status})`;
}

export function isWorkflowRunCronSuccess(view: WorkflowRunView): boolean {
  return view.run.status === 'succeeded';
}

export function buildWorkflowRunDeliveryText(view: WorkflowRunView): string {
  const snapshot = runViewToSnapshot(view);
  const completed = view.run.status === 'succeeded';
  const body = renderWorkflowText(snapshot, completed, { showResultPreviews: true });
  const header = buildWorkflowRunCronSummary(view);
  return `${header}\n\n${body}`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  }).catch((err) => {
    if (signal.aborted || (err instanceof Error && err.message === 'aborted')) {
      return;
    }
    throw err;
  });
}
