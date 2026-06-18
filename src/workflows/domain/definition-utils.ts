import type { WorkflowMeta } from '../../agent/workflow/types.js';

import type { WorkflowDefinition, WorkflowDefinitionManifest } from './definition.js';

export const DEFAULT_WORKFLOW_CONCURRENCY = 4;
export const DEFAULT_WORKFLOW_TIMEOUT_SEC = 30 * 60;
export const DEFAULT_WORKFLOW_MAX_SUBAGENTS = 100;

export interface WorkflowDefinitionBuildInput {
  name: string;
  source: 'builtin' | 'user';
  script: string;
  meta: WorkflowMeta;
  manifest?: WorkflowDefinitionManifest;
}

export function buildWorkflowDefinition(input: WorkflowDefinitionBuildInput): WorkflowDefinition {
  const nowMs = Date.now();
  const phases = input.meta.phases?.map((phase, index) => ({
    id: normalizeWorkflowDefinitionId(phase.title) || `phase-${index + 1}`,
    title: phase.title,
    description: phase.detail,
  })) ?? [];

  const manifest = input.manifest;
  const manifestDefaults = manifest?.defaults ?? {};

  return {
    id: input.name,
    name: input.name,
    title: manifest?.title ?? toWorkflowDefinitionTitle(input.name),
    description: manifest?.description ?? input.meta.description,
    version: manifest?.version ?? '1.0.0',
    inputSchema: manifest?.inputSchema,
    outputSchema: manifest?.outputSchema,
    phases,
    runtime: {
      kind: 'script',
      source: input.script,
    },
    defaults: {
      concurrency: normalizePositiveInt(manifestDefaults.concurrency, DEFAULT_WORKFLOW_CONCURRENCY),
      timeoutSec: normalizePositiveInt(manifestDefaults.timeoutSec, DEFAULT_WORKFLOW_TIMEOUT_SEC),
      maxSubagents: normalizePositiveInt(
        manifestDefaults.maxSubagents,
        input.meta.estimatedAgents?.max ?? DEFAULT_WORKFLOW_MAX_SUBAGENTS,
      ),
    },
    permissions: manifest?.permissions,
    resources: manifest?.resources,
    metadata: {
      tags: manifest?.tags ?? input.meta.tags ?? [],
      builtIn: input.source === 'builtin',
      source: input.source,
      whenToUse: manifest?.whenToUse ?? input.meta.whenToUse,
      estimatedAgents: input.meta.estimatedAgents,
      examplePrompts: input.meta.examplePrompts,
      i18n: input.meta.i18n,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    },
  };
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
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
