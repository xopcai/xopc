import type { BrowserAutomation } from './browser-automation-api';

export function defaultBrowserAutomationInputs(automation: BrowserAutomation): Record<string, unknown> {
  return Object.fromEntries(Object.entries(automation.inputs).flatMap(([name, input]) => (
    input.default === undefined ? [] : [[name, input.default]]
  )));
}

export function browserAutomationInputsComplete(
  automation: BrowserAutomation,
  values: Record<string, unknown>,
): boolean {
  return !Object.entries(automation.inputs).some(([name, input]) => (
    input.required && (values[name] === undefined || values[name] === '')
  ));
}
