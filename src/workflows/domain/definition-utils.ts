import type { WorkflowMeta } from '../../agent/workflow/types.js';

import type { WorkflowDefinition } from './definition.js';

export const DEFAULT_WORKFLOW_CONCURRENCY = 4;
export const DEFAULT_WORKFLOW_TIMEOUT_SEC = 30 * 60;
export const DEFAULT_WORKFLOW_MAX_SUBAGENTS = 100;

export interface WorkflowDefinitionBuildInput {
  name: string;
  source: 'builtin' | 'user';
  script: string;
  meta: WorkflowMeta;
}

export function buildWorkflowDefinition(input: WorkflowDefinitionBuildInput): WorkflowDefinition {
  const nowMs = Date.now();
  const phases = input.meta.phases?.map((phase, index) => ({
    id: normalizeWorkflowDefinitionId(phase.title) || `phase-${index + 1}`,
    title: phase.title,
    description: phase.detail,
  })) ?? [];

  return {
    id: input.name,
    name: input.name,
    title: toWorkflowDefinitionTitle(input.name),
    description: input.meta.description,
    version: '1.0.0',
    phases,
    runtime: {
      kind: 'script',
      source: input.script,
    },
    defaults: {
      concurrency: DEFAULT_WORKFLOW_CONCURRENCY,
      timeoutSec: DEFAULT_WORKFLOW_TIMEOUT_SEC,
      maxSubagents: input.meta.estimatedAgents?.max ?? DEFAULT_WORKFLOW_MAX_SUBAGENTS,
    },
    metadata: {
      tags: input.meta.tags ?? [],
      builtIn: input.source === 'builtin',
      source: input.source,
      whenToUse: input.meta.whenToUse,
      estimatedAgents: input.meta.estimatedAgents,
      examplePrompts: input.meta.examplePrompts,
      i18n: input.meta.i18n,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    },
  };
}

export function normalizeWorkflowDefinitionId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function toWorkflowDefinitionTitle(value: string): string {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
