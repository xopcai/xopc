import type { WorkflowDefinitionManifest } from '../domain/definition.js';
import type { WorkflowDefinitionValidationResult } from '../domain/validation.js';

export type WorkflowDraftMode = 'create' | 'improve';

export interface WorkflowDraftConstraints {
  allowedTools?: string[];
  allowNetwork?: boolean;
  fileSystem?: 'none' | 'read' | 'write';
  maxPhases?: number;
  maxSubagents?: number;
  outputFormat?: 'report' | 'json' | 'actions';
}

export interface CreateWorkflowDraftRequest {
  prompt: string;
  agentId: string;
  language?: 'en' | 'zh';
  mode?: WorkflowDraftMode;
  existingScript?: string;
  constraints?: WorkflowDraftConstraints;
}

export interface WorkflowDraftLintIssue {
  severity: 'error' | 'warning';
  code:
    | 'missing_input_schema'
    | 'missing_output_schema'
    | 'unsafe_permission'
    | 'too_many_agents'
    | 'unknown_tool'
    | 'weak_phase_names'
    | 'unbounded_parallelism';
  message: string;
}

export interface GeneratedWorkflowDraft {
  name: string;
  script: string;
  manifest: WorkflowDefinitionManifest;
  explanation: string;
  assumptions: string[];
  risks: string[];
}

export interface WorkflowDraftResponse extends GeneratedWorkflowDraft {
  draftId: string;
  repairAttempts: number;
  permissionsSummary: string[];
  validation: WorkflowDefinitionValidationResult;
  lint: WorkflowDraftLintIssue[];
  suggestedInputs?: Array<{
    key: string;
    label: string;
    example: string;
  }>;
}
