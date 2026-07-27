import type { JsonSchema } from './workflow-api';

export type SchemaInputValue = Record<string, unknown>;

export interface SchemaField {
  key: string;
  schema: JsonSchema;
  required: boolean;
}

export function supportsWorkflowSchemaForm(schema: JsonSchema | undefined): boolean {
  return Boolean(
    schema &&
      schema.type === 'object' &&
      schema.properties &&
      !Array.isArray(schema.properties),
  );
}

export function schemaToFields(schema: JsonSchema): SchemaField[] {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  return Object.entries(properties).map(([key, fieldSchema]) => ({
    key,
    schema: fieldSchema,
    required: required.has(key),
  }));
}

export function validateWorkflowSchemaInput(
  schema: JsonSchema | undefined,
  value: SchemaInputValue,
): boolean {
  if (!supportsWorkflowSchemaForm(schema) || !schema) return true;
  return schemaToFields(schema).every((field) => {
    if (!field.required) return true;
    const raw = value[field.key];
    if (raw === undefined || raw === null) return false;
    return typeof raw === 'string' ? raw.trim().length > 0 : true;
  });
}
