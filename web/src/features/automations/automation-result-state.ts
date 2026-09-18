import type { Automation, AutomationRun } from './automation-api';

export function latestAutomationRun(automationId: string, runs: AutomationRun[]): AutomationRun | undefined {
  return runs.reduce<AutomationRun | undefined>((latest, run) => (
    run.automationId === automationId && (!latest || run.createdAtMs > latest.createdAtMs) ? run : latest
  ), undefined);
}

export function automationExecutionIssueMarker(automation: Automation, runs: AutomationRun[]): string | null {
  const latest = latestAutomationRun(automation.id, runs);
  // The task state remains available when its latest run is outside the results window.
  const useTaskState = Boolean(
    automation.state.lastRunAtMs && (!latest || automation.state.lastRunAtMs > latest.createdAtMs),
  );
  const status = useTaskState
    ? automation.state.lastRunStatus
    : latest?.status ?? automation.state.lastRunStatus;
  if (status !== 'failed' && status !== 'timeout') return null;
  const occurredAtMs = useTaskState
    ? automation.state.lastRunAtMs
    : latest?.createdAtMs ?? automation.state.lastRunAtMs;
  return `${status}:${occurredAtMs ?? 'unknown'}`;
}

export function automationHasExecutionIssue(automation: Automation, runs: AutomationRun[]): boolean {
  return automationExecutionIssueMarker(automation, runs) !== null;
}
