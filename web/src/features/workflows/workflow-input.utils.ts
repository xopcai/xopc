import { WORKFLOW_ARG_FIELDS } from './workflow-page.constants';

export function resolveWorkflowArgLabel(
  args: Record<string, string>,
  key: string,
): string {
  return args[key] ?? key;
}

/** Map stored workflow input payload into form field values. */
export function workflowInputToArgValues(
  workflowName: string,
  input: unknown,
): Record<string, string> {
  const fields = WORKFLOW_ARG_FIELDS[workflowName] ?? [];
  if (fields.length === 0) return {};

  const record =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  const values: Record<string, string> = {};
  for (const field of fields) {
    const raw = record[field.key];
    if (raw != null) values[field.key] = String(raw);
  }
  return values;
}

export function validateWorkflowArgValues(
  workflowName: string,
  argValues: Record<string, string>,
): boolean {
  const fields = WORKFLOW_ARG_FIELDS[workflowName] ?? [];
  return fields.every((field) => !field.required || Boolean(argValues[field.key]?.trim()));
}
