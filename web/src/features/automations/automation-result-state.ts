import type { Automation, AutomationRun } from './automation-api';

export function automationRunFailureSummary(run: Pick<AutomationRun, 'error' | 'status'>, language: 'zh' | 'en'): string {
  const zh = language === 'zh';
  if (run.error?.includes('The selected model is unavailable:')) return zh ? '所选模型不可用，请更换模型或恢复默认模型后重试。' : 'The selected model is unavailable. Choose another model or use the default.';
  if (run.error?.startsWith('Execution assistant is unavailable:')) return zh ? '执行助手暂不可用，请选择其他助手后重试。' : 'The execution assistant is unavailable. Choose another assistant.';
  if (run.status === 'timeout') return zh ? '任务超时未完成，可以通过对话调整后重试。' : 'The task timed out. Adjust it in chat and try again.';
  return run.error ?? (zh ? '这次运行未完成，可以通过对话排查原因。' : 'This run did not finish. Ask in chat to investigate.');
}

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
