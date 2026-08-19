import type { BrowserWorkflow } from './browser-workflow-api';

export function defaultBrowserWorkflowInputs(workflow: BrowserWorkflow): Record<string, unknown> {
  return Object.fromEntries(Object.entries(workflow.inputs).flatMap(([name, input]) => (
    input.default === undefined ? [] : [[name, input.default]]
  )));
}

export function browserWorkflowInputsComplete(
  workflow: BrowserWorkflow,
  values: Record<string, unknown>,
): boolean {
  return !Object.entries(workflow.inputs).some(([name, input]) => (
    input.required && (values[name] === undefined || values[name] === '')
  ));
}
