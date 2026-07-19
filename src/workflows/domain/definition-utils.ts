import { createHash } from 'node:crypto';

import type {
  WorkflowDefinition,
  WorkflowDefinitionManifest,
  WorkflowGraph,
  WorkflowPhaseDefinition,
} from './definition.js';

export const DEFAULT_WORKFLOW_CONCURRENCY = 4;
export const DEFAULT_WORKFLOW_TIMEOUT_SEC = 30 * 60;
export const DEFAULT_WORKFLOW_MAX_SUBAGENTS = 100;

export interface WorkflowDefinitionBuildInput {
  name: string;
  source: 'builtin' | 'user';
  graph: WorkflowGraph;
  manifest?: WorkflowDefinitionManifest;
  phases?: WorkflowPhaseDefinition[];
  revision?: number;
  createdAtMs?: number;
}

export function buildWorkflowDefinition(input: WorkflowDefinitionBuildInput): WorkflowDefinition {
  const nowMs = Date.now();
  const manifest = input.manifest;
  const manifestDefaults = manifest?.defaults ?? {};
  const phases = input.phases ?? deriveWorkflowPhases(input.graph);
  const graphHash = hashWorkflowStableValue(input.graph);
  const base = {
    id: input.name,
    name: input.name,
    title: manifest?.title ?? toWorkflowDefinitionTitle(input.name),
    description: manifest?.description ?? '',
    version: manifest?.version ?? '1.0.0',
    revision: input.revision ?? 1,
    inputSchema: manifest?.inputSchema,
    outputSchema: manifest?.outputSchema,
    phases,
    graph: structuredClone(input.graph),
    defaults: {
      concurrency: normalizePositiveInt(manifestDefaults.concurrency, DEFAULT_WORKFLOW_CONCURRENCY),
      timeoutSec: normalizePositiveInt(manifestDefaults.timeoutSec, DEFAULT_WORKFLOW_TIMEOUT_SEC),
      maxSubagents: normalizePositiveInt(manifestDefaults.maxSubagents, DEFAULT_WORKFLOW_MAX_SUBAGENTS),
    },
    permissions: manifest?.permissions,
    resources: manifest?.resources,
    connectors: manifest?.connectors,
    metadata: {
      tags: manifest?.tags ?? [],
      builtIn: input.source === 'builtin',
      source: input.source,
      whenToUse: manifest?.whenToUse,
      estimatedAgents: manifest?.estimatedAgents,
      examplePrompts: manifest?.examplePrompts,
      i18n: manifest?.i18n,
      createdAtMs: input.createdAtMs ?? nowMs,
      updatedAtMs: nowMs,
    },
  } satisfies Omit<WorkflowDefinition, 'contentHash'>;

  return {
    ...base,
    contentHash: hashWorkflowStableValue({
      name: base.name,
      title: base.title,
      description: base.description,
      version: base.version,
      revision: base.revision,
      graphHash,
      defaults: base.defaults,
      permissions: base.permissions,
      resources: base.resources,
      connectors: base.connectors,
    }),
  };
}

export function deriveWorkflowPhases(graph: WorkflowGraph): WorkflowPhaseDefinition[] {
  const phases = new Map<string, WorkflowPhaseDefinition>();
  for (const node of graph.nodes) {
    if (!node.phaseId || phases.has(node.phaseId)) continue;
    phases.set(node.phaseId, {
      id: node.phaseId,
      title: toWorkflowDefinitionTitle(node.phaseId),
    });
  }
  return [...phases.values()];
}

export function hashWorkflowStableValue(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

export function normalizeWorkflowDefinitionId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function toWorkflowDefinitionTitle(value: string): string {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
