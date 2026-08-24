import type { Automation, AutomationRun } from '@xopcai/gateway-contract';

export function formatAutomationDate(timestamp: number | undefined, locale: string): string | undefined {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return undefined;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

export function formatAutomationDuration(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return undefined;
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function automationActionPreview(automation: Automation): string {
  switch (automation.action.kind) {
    case 'agent': return automation.action.instruction.trim();
    case 'workflow': return automation.action.goal?.trim() || automation.action.workflowId;
    case 'browser_recipe': return automation.action.recipeId;
    case 'task_command': return `${automation.action.taskId} · ${automation.action.command.type}`;
  }
}

export function automationRunStart(run: AutomationRun): number {
  return run.startedAtMs ?? run.createdAtMs;
}

export function isAutomationRunActive(run: AutomationRun): boolean {
  return run.status === 'queued' || run.status === 'running' || run.status === 'cancelling';
}

export function isAutomationRunProblem(run: AutomationRun): boolean {
  return run.status === 'failed' || run.status === 'timeout';
}
