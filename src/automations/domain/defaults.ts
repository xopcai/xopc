import type { AutomationAction } from './types.js';

export const DEFAULT_AUTOMATION_TIMEOUT_SECONDS = 30 * 60;
export const DEFAULT_BROWSER_AUTOMATION_TIMEOUT_SECONDS = 10 * 60;

export function defaultAutomationTimeoutSeconds(action: AutomationAction): number {
  return action.kind === 'browser_recipe'
    ? DEFAULT_BROWSER_AUTOMATION_TIMEOUT_SECONDS
    : DEFAULT_AUTOMATION_TIMEOUT_SECONDS;
}

export function resolveAutomationTimeoutSeconds(
  action: AutomationAction,
  reliability?: { executionTimeoutSeconds?: number; timeoutSeconds?: number },
): number {
  return reliability?.executionTimeoutSeconds
    ?? ('timeoutSeconds' in action ? action.timeoutSeconds : undefined)
    ?? reliability?.timeoutSeconds
    ?? defaultAutomationTimeoutSeconds(action);
}
