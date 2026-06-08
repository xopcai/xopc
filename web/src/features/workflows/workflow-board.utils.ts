import type { WorkflowRunSummary, WorkflowRunStatus } from './workflow-api';
import { runMatchesTriggerFilter } from './workflow-page.utils';

export const WORKFLOW_BOARD_COLUMNS = ['queued', 'running', 'succeeded', 'attention'] as const;
export type WorkflowBoardColumnId = (typeof WORKFLOW_BOARD_COLUMNS)[number];

export const BOARD_SUCCEEDED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const BOARD_SUCCEEDED_MAX = 20;
export const BOARD_SUCCEEDED_COLLAPSED = 5;

const ATTENTION_STATUSES = new Set<WorkflowRunStatus>(['failed', 'timeout', 'cancelled']);

export function resolveRunSessionKey(run: WorkflowRunSummary): string | null {
  const key = run.metadata?.sessionKey?.trim();
  return key || null;
}

function truncateCardText(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen - 1)}…`;
}

function extractStringField(value: unknown, fieldNames: string[]): string | null {
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  for (const fieldName of fieldNames) {
    const fieldValue = record[fieldName];
    if (typeof fieldValue === 'string' && fieldValue.trim()) return fieldValue.trim();
  }

  return null;
}

export function resolveRunUserQuery(run: WorkflowRunSummary, maxLen = 90): string | null {
  const raw = run.metadata?.input?.goal?.trim()
    || (typeof run.metadata?.input?.payload === 'string' ? run.metadata.input.payload.trim() : null)
    || extractStringField(run.metadata?.input?.payload, ['query', 'goal', 'prompt', 'input', 'message'])
    || extractStringField(run.metadata?.input?.variables, ['query', 'goal', 'prompt', 'input', 'message']);

  if (!raw) return null;
  return truncateCardText(raw, maxLen);
}

export function resolveRunCardTitle(run: WorkflowRunSummary, maxLen = 90): string {
  return resolveRunUserQuery(run, maxLen) ?? truncateCardText(run.title?.trim() || run.definitionId, maxLen);
}

export function resolveRunWorkflowLabel(run: WorkflowRunSummary, maxLen = 44): string {
  return truncateCardText(run.title?.trim() || run.definitionId, maxLen);
}

export function runMatchesBoardSearch(run: WorkflowRunSummary, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    resolveRunUserQuery(run, 500),
    run.title,
    run.definitionId,
    run.id,
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(normalized);
}

export function filterRunsForBoard(
  runs: WorkflowRunSummary[],
  opts: { searchQuery: string; workflowFilterId: string; triggerFilter?: string },
): WorkflowRunSummary[] {
  const wf = opts.workflowFilterId.trim();
  return runs.filter((run) => {
    if (wf && run.definitionId !== wf) return false;
    if (!runMatchesTriggerFilter(run, opts.triggerFilter ?? 'all')) return false;
    return runMatchesBoardSearch(run, opts.searchQuery);
  });
}

function runCompletedAtMs(run: WorkflowRunSummary): number {
  return run.completedAtMs ?? run.createdAtMs;
}

function isWithinSucceededWindow(run: WorkflowRunSummary, nowMs: number): boolean {
  const at = runCompletedAtMs(run);
  return nowMs - at <= BOARD_SUCCEEDED_WINDOW_MS;
}

export function boardColumnForRun(
  run: WorkflowRunSummary,
  nowMs: number,
): WorkflowBoardColumnId | null {
  if (run.status === 'queued') return 'queued';
  if (run.status === 'running') return 'running';
  if (run.status === 'succeeded') {
    return isWithinSucceededWindow(run, nowMs) ? 'succeeded' : null;
  }
  if (ATTENTION_STATUSES.has(run.status)) return 'attention';
  return null;
}

export function sortRunsForBoardColumn(
  column: WorkflowBoardColumnId,
  runs: WorkflowRunSummary[],
): WorkflowRunSummary[] {
  const copy = [...runs];
  if (column === 'queued') {
    return copy.sort((a, b) => a.createdAtMs - b.createdAtMs);
  }
  if (column === 'running') {
    return copy.sort((a, b) => (b.startedAtMs ?? b.createdAtMs) - (a.startedAtMs ?? a.createdAtMs));
  }
  return copy.sort((a, b) => runCompletedAtMs(b) - runCompletedAtMs(a));
}

export type WorkflowBoardColumnData = {
  id: WorkflowBoardColumnId;
  runs: WorkflowRunSummary[];
  /** Succeeded column only: total matching 7d window before max cap */
  totalInWindow?: number;
  /** Succeeded column only: count hidden by 20-cap */
  hiddenByCap?: number;
};

export function buildWorkflowBoardColumns(
  runs: WorkflowRunSummary[],
  nowMs: number,
): WorkflowBoardColumnData[] {
  const buckets: Record<WorkflowBoardColumnId, WorkflowRunSummary[]> = {
    queued: [],
    running: [],
    succeeded: [],
    attention: [],
  };

  for (const run of runs) {
    const column = boardColumnForRun(run, nowMs);
    if (column) buckets[column].push(run);
  }

  const succeededSorted = sortRunsForBoardColumn('succeeded', buckets.succeeded);
  const totalInWindow = succeededSorted.length;
  const capped = succeededSorted.slice(0, BOARD_SUCCEEDED_MAX);
  const hiddenByCap = Math.max(0, totalInWindow - BOARD_SUCCEEDED_MAX);

  return WORKFLOW_BOARD_COLUMNS.map((id) => {
    if (id === 'succeeded') {
      return {
        id,
        runs: capped,
        totalInWindow,
        hiddenByCap,
      };
    }
    return {
      id,
      runs: sortRunsForBoardColumn(id, buckets[id]),
    };
  });
}

export function formatRelativeTime(ms: number, nowMs: number, localeTag: string): string {
  const deltaSec = Math.round((nowMs - ms) / 1000);
  if (deltaSec < 60) return new Intl.RelativeTimeFormat(localeTag, { numeric: 'auto' }).format(-deltaSec, 'second');
  const deltaMin = Math.round(deltaSec / 60);
  if (deltaMin < 60) return new Intl.RelativeTimeFormat(localeTag, { numeric: 'auto' }).format(-deltaMin, 'minute');
  const deltaHour = Math.round(deltaMin / 60);
  if (deltaHour < 48) return new Intl.RelativeTimeFormat(localeTag, { numeric: 'auto' }).format(-deltaHour, 'hour');
  const deltaDay = Math.round(deltaHour / 24);
  return new Intl.RelativeTimeFormat(localeTag, { numeric: 'auto' }).format(-deltaDay, 'day');
}

export function isRunActive(run: WorkflowRunSummary): boolean {
  return run.status === 'queued' || run.status === 'running';
}

export function isRunRetriable(run: WorkflowRunSummary): boolean {
  return run.status === 'failed' || run.status === 'timeout' || run.status === 'cancelled';
}
