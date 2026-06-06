import type { WorkflowDefinition, WorkflowRunStatus, WorkflowRunSummary } from './workflow-api';
import { collectWorkflowSearchText } from './workflow-meta-locale';
import {
  ACTIVE_RUN_STATUSES,
  HISTORY_RUN_STATUSES,
  WORKFLOW_CATEGORY_TAGS,
  type WorkflowCategoryFilter,
  type WorkflowSourceFilter,
} from './workflow-page.constants';

export function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

export function formatTime(ms: number | undefined, localeTag: string): string {
  if (!ms) return '—';
  return new Intl.DateTimeFormat(localeTag, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

export function formatDuration(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '—';
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes < 60) return remainSeconds ? `${minutes}m ${remainSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes ? `${hours}h ${remainMinutes}m` : `${hours}h`;
}

export function statusTone(status: WorkflowRunStatus): string {
  if (status === 'succeeded') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed' || status === 'timeout') return 'bg-red-500/15 text-red-700 dark:text-red-300';
  if (status === 'cancelled') return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
  return 'bg-accent-soft text-accent-fg';
}

export function matchesCategory(definition: WorkflowDefinition, category: WorkflowCategoryFilter): boolean {
  if (category === 'all') return true;
  const tags = definition.metadata.tags.map((tag) => tag.toLowerCase());
  const categoryTags = WORKFLOW_CATEGORY_TAGS[category];
  return categoryTags.some((tag) => tags.includes(tag));
}

export function matchesSource(definition: WorkflowDefinition, source: WorkflowSourceFilter): boolean {
  if (source === 'all') return true;
  if (source === 'builtin') return definition.metadata.builtIn;
  return definition.metadata.source === 'user';
}

export function filterDefinitions(
  definitions: WorkflowDefinition[],
  query: string,
  category: WorkflowCategoryFilter,
  source: WorkflowSourceFilter,
): WorkflowDefinition[] {
  const normalized = query.trim().toLowerCase();
  return definitions.filter((definition) => {
    if (!matchesCategory(definition, category)) return false;
    if (!matchesSource(definition, source)) return false;
    if (!normalized) return true;
    return collectWorkflowSearchText(definition).includes(normalized);
  });
}

export function filterRunsByTab(runs: WorkflowRunSummary[], tab: 'active' | 'history'): WorkflowRunSummary[] {
  if (tab === 'active') {
    return runs.filter((run) => ACTIVE_RUN_STATUSES.has(run.status));
  }
  return runs.filter((run) => HISTORY_RUN_STATUSES.has(run.status));
}

export function stringifyWorkflowResult(result: unknown): string {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export function resolveWorkflowResultForDisplay(result: unknown): unknown {
  if (result == null) return result;
  if (typeof result === 'object' && result !== null && 'raw' in result) {
    const raw = (result as { raw?: unknown }).raw;
    return raw !== undefined ? raw : result;
  }
  return result;
}

export function buildWorkflowInput(args: Record<string, string>): unknown {
  const input: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    const trimmed = value.trim();
    if (trimmed) input[key] = trimmed;
  }
  return Object.keys(input).length > 0 ? input : undefined;
}
