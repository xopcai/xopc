import type { Automation, AutomationRun } from './automation-api';

export function latestAutomationRun(automationId: string, runs: AutomationRun[]): AutomationRun | undefined {
  return runs.reduce<AutomationRun | undefined>((latest, run) => (
    run.automationId === automationId && (!latest || run.createdAtMs > latest.createdAtMs) ? run : latest
  ), undefined);
}

export function automationHasExecutionIssue(automation: Automation, runs: AutomationRun[]): boolean {
  const latest = latestAutomationRun(automation.id, runs);
  // The task state remains available when its latest run is outside the results window.
  const status = automation.state.lastRunAtMs && (!latest || automation.state.lastRunAtMs > latest.createdAtMs)
    ? automation.state.lastRunStatus
    : latest?.status ?? automation.state.lastRunStatus;
  return status === 'failed' || status === 'timeout';
}
