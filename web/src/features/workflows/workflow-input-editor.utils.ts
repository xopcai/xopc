import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowDefinition } from './workflow-api';
import { resolveWorkflowLocalizedCopy } from './workflow-meta-locale';
import { WORKFLOW_ARG_FIELDS } from './workflow-page.constants';
import { buildWorkflowInput } from './workflow-page.utils';
import {
  supportsWorkflowSchemaForm,
  validateWorkflowSchemaInput,
  type SchemaInputValue,
} from './workflow-schema-input';

export interface WorkflowInputEditorValue {
  goal: string;
  argValues: Record<string, string>;
  schemaInput: SchemaInputValue;
}

export interface WorkflowInputEditorValidity {
  valid: boolean;
  reason?: 'schema-required' | 'raw-json';
}

export function resolveWorkflowInputPayload(
  definition: WorkflowDefinition | null | undefined,
  value: WorkflowInputEditorValue,
): unknown {
  if (!definition) return undefined;
  if (supportsWorkflowSchemaForm(definition.inputSchema)) {
    return Object.keys(value.schemaInput).length > 0 ? value.schemaInput : undefined;
  }
  return buildWorkflowInput(value.argValues);
}

export function summarizeWorkflowInput(
  definition: WorkflowDefinition | null | undefined,
  language: StoredLanguage,
  value: WorkflowInputEditorValue,
): string {
  const labels = messages(language).workflows;
  if (!definition) return labels.noInputSummary;
  const localized = resolveWorkflowLocalizedCopy(definition, language);
  if (
    supportsWorkflowSchemaForm(definition.inputSchema) &&
    Object.keys(value.schemaInput).length > 0
  ) {
    return Object.entries(value.schemaInput)
      .map(([key, item]) => `${key}: ${String(item)}`)
      .join(' · ');
  }
  const parts = Object.values(value.argValues)
    .map((item) => item.trim())
    .filter(Boolean);
  const resolvedGoal = value.goal.trim() || localized.description;
  if (resolvedGoal) parts.unshift(resolvedGoal);
  return parts.length > 0 ? parts.join(' · ') : labels.noInputSummary;
}

export function validateWorkflowInputEditorValue(
  definition: WorkflowDefinition | null | undefined,
  value: WorkflowInputEditorValue,
  rawJsonValid = true,
): WorkflowInputEditorValidity {
  if (!definition) return { valid: false };
  if (!rawJsonValid) return { valid: false, reason: 'raw-json' };
  if (supportsWorkflowSchemaForm(definition.inputSchema)) {
    return validateWorkflowSchemaInput(definition.inputSchema, value.schemaInput)
      ? { valid: true }
      : { valid: false, reason: 'schema-required' };
  }
  const fields = WORKFLOW_ARG_FIELDS[definition.name] ?? [];
  return {
    valid: fields.every(
      (field) => !field.required || Boolean(value.argValues[field.key]?.trim()),
    ),
  };
}
