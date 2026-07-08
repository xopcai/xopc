import type { WorkflowRunSummary, WorkflowRunStatus } from './workflow-api';
import { runMatchesTriggerFilter } from './workflow-page.utils';

export const WORKFLOW_BOARD_COLUMNS = ['queued', 'running', 'succeeded', 'attention'] as const;
export type WorkflowBoardColumnId = (typeof WORKFLOW_BOARD_COLUMNS)[number];

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

export function boardColumnForRun(
  run: WorkflowRunSummary,
  _nowMs: number,
): WorkflowBoardColumnId | null {
  if (run.status === 'queued') return 'queued';
  if (run.status === 'running') return 'running';
  if (run.status === 'succeeded') return 'succeeded';
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
  /** Succeeded column only: total matching runs in the fetched result set. */
  totalInWindow?: number;
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

  return WORKFLOW_BOARD_COLUMNS.map((id) => {
    if (id === 'succeeded') {
      const runs = sortRunsForBoardColumn('succeeded', buckets.succeeded);
      return {
        id,
        runs,
        totalInWindow: runs.length,
      };
    }
    return {
      id,
      runs: sortRunsForBoardColumn(id, buckets[id]),
    };
  });
}

const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();

function getRelativeTimeFormatter(localeTag: string): Intl.RelativeTimeFormat {
  let formatter = relativeTimeFormatters.get(localeTag);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(localeTag, { numeric: 'auto' });
    relativeTimeFormatters.set(localeTag, formatter);
  }
  return formatter;
}

export function formatRelativeTime(ms: number, nowMs: number, localeTag: string): string {
  const deltaSec = Math.round((nowMs - ms) / 1000);
  const rtf = getRelativeTimeFormatter(localeTag);
  if (deltaSec < 60) return rtf.format(-deltaSec, 'second');
  const deltaMin = Math.round(deltaSec / 60);
  if (deltaMin < 60) return rtf.format(-deltaMin, 'minute');
  const deltaHour = Math.round(deltaMin / 60);
  if (deltaHour < 48) return rtf.format(-deltaHour, 'hour');
  const deltaDay = Math.round(deltaHour / 24);
  return rtf.format(-deltaDay, 'day');
}

export function isRunActive(run: WorkflowRunSummary): boolean {
  return run.status === 'queued' || run.status === 'running';
}

export function isRunRetriable(run: WorkflowRunSummary): boolean {
  return run.status === 'failed' || run.status === 'timeout' || run.status === 'cancelled';
}
