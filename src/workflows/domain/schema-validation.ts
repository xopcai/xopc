import Ajv, { type ErrorObject } from 'ajv';

import type { JsonSchema } from './definition.js';

const ajv = new Ajv({ allErrors: true, strict: false });

export interface WorkflowSchemaValidationResult {
  ok: boolean;
  message?: string;
  errors?: ErrorObject[];
}

export function validateWorkflowJsonSchema(
  schema: JsonSchema | undefined,
  value: unknown,
): WorkflowSchemaValidationResult {
  if (!schema) {
    return { ok: true };
  }

  let validate: ReturnType<typeof ajv.compile>;
  try {
    validate = ajv.compile(schema);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Invalid workflow schema: ${message}` };
  }

  if (validate(value)) {
    return { ok: true };
  }

  return {
    ok: false,
    message: ajv.errorsText(validate.errors, { separator: '; ' }),
    errors: validate.errors ?? undefined,
  };
}
