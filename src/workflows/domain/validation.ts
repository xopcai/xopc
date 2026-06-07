import { parseWorkflowScript } from '../../agent/workflow/parser.js';

import type { WorkflowDefinition } from './definition.js';
import { buildWorkflowDefinition } from './definition-utils.js';

export type WorkflowDefinitionValidationIssueCode =
  | 'name_required'
  | 'script_required'
  | 'parse_failed'
  | 'meta_name_mismatch'
  | 'unknown_error';

export interface WorkflowDefinitionValidationIssue {
  code: WorkflowDefinitionValidationIssueCode;
  message: string;
  line?: number;
  column?: number;
}

export interface WorkflowDefinitionValidationResult {
  valid: boolean;
  errors: WorkflowDefinitionValidationIssue[];
  warnings: WorkflowDefinitionValidationIssue[];
  definition?: WorkflowDefinition;
}

export interface ValidateWorkflowDefinitionInput {
  name?: string;
  script?: string;
}

const NAME_RE = /^[a-z][a-z0-9_-]*$/;

export function validateWorkflowDefinitionInput(
  input: ValidateWorkflowDefinitionInput,
): WorkflowDefinitionValidationResult {
  const name = input.name?.trim() ?? '';
  const script = input.script ?? '';
  const errors: WorkflowDefinitionValidationIssue[] = [];
  const warnings: WorkflowDefinitionValidationIssue[] = [];

  if (!name) {
    errors.push({ code: 'name_required', message: 'Workflow name is required.' });
  } else if (!NAME_RE.test(name)) {
    errors.push({
      code: 'parse_failed',
      message: `Invalid workflow name "${name}". Use lowercase snake_case, e.g. "audit_repo".`,
    });
  }

  if (!script.trim()) {
    errors.push({ code: 'script_required', message: 'Workflow script is required.' });
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  try {
    const { meta } = parseWorkflowScript(script);
    if (meta.name !== name) {
      errors.push({
        code: 'meta_name_mismatch',
        message: `meta.name "${meta.name}" does not match workflow name "${name}".`,
      });
      return { valid: false, errors, warnings };
    }

    return {
      valid: true,
      errors,
      warnings,
      definition: buildWorkflowDefinition({
        name,
        source: 'user',
        script,
        meta,
      }),
    };
  } catch (err) {
    errors.push({
      code: 'parse_failed',
      message: err instanceof Error ? err.message : String(err),
    });
    return { valid: false, errors, warnings };
  }
}
