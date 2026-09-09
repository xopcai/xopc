import type {
  WorkflowDefinition,
  WorkflowDefinitionManifest,
  WorkflowGraph,
  WorkflowRunDefinitionSnapshot,
} from './workflow-api';
import { definitionToManifest } from './workflow-definition-manifest';

export const WORKFLOW_SOURCE_FORMAT_VERSION = 1 as const;

export interface WorkflowSourceDocument {
  formatVersion: typeof WORKFLOW_SOURCE_FORMAT_VERSION;
  name: string;
  manifest: WorkflowDefinitionManifest;
  graph: WorkflowGraph;
}

export type WorkflowSourceParseResult =
  | { ok: true; document: WorkflowSourceDocument }
  | { ok: false; error: string };

export function workflowDefinitionToSourceDocument(definition: WorkflowDefinition): WorkflowSourceDocument {
  return workflowPartsToSourceDocument(definition.name, definition.graph, definitionToManifest(definition));
}

export function workflowPartsToSourceDocument(
  name: string,
  graph: WorkflowGraph,
  manifest: WorkflowDefinitionManifest,
): WorkflowSourceDocument {
  return {
    formatVersion: WORKFLOW_SOURCE_FORMAT_VERSION,
    name,
    manifest: structuredClone(manifest),
    graph: structuredClone(graph),
  };
}

export function workflowRunSnapshotToSourceDocument(snapshot: WorkflowRunDefinitionSnapshot): WorkflowSourceDocument {
  return workflowPartsToSourceDocument(snapshot.name, snapshot.graph, {
    title: snapshot.title,
    description: snapshot.description,
    version: snapshot.version,
    defaults: snapshot.defaults,
    tags: snapshot.tags,
    estimatedAgents: snapshot.estimatedAgents,
    permissions: snapshot.permissions,
    resources: snapshot.resources,
    connectors: snapshot.connectors,
    inputSchema: snapshot.inputSchema,
    outputSchema: snapshot.outputSchema,
    whenToUse: snapshot.whenToUse,
    examplePrompts: snapshot.examplePrompts,
    i18n: snapshot.i18n,
  });
}

export interface WorkflowSourceDiffLine {
  kind: 'same' | 'added' | 'removed';
  beforeLine?: number;
  afterLine?: number;
  text: string;
}

export function buildWorkflowSourceDiff(before: string, after: string): WorkflowSourceDiffLine[] {
  const left = splitLines(before);
  const right = splitLines(after);
  if (left.length * right.length > 250_000) return buildBoundedDiff(left, right);

  const table = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const result: WorkflowSourceDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      result.push({ kind: 'same', beforeLine: i + 1, afterLine: j + 1, text: left[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push({ kind: 'removed', beforeLine: i + 1, text: left[i] });
      i += 1;
    } else {
      result.push({ kind: 'added', afterLine: j + 1, text: right[j] });
      j += 1;
    }
  }
  while (i < left.length) result.push({ kind: 'removed', beforeLine: ++i, text: left[i - 1] });
  while (j < right.length) result.push({ kind: 'added', afterLine: ++j, text: right[j - 1] });
  return result;
}

export function serializeWorkflowSourceDocument(document: WorkflowSourceDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseWorkflowSourceDocument(source: string): WorkflowSourceParseResult {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'Invalid JSON.' };
  }
  if (!isRecord(value)) return invalid('The source root must be a JSON object.');
  if (value.formatVersion !== WORKFLOW_SOURCE_FORMAT_VERSION) return invalid('formatVersion must be 1.');
  if (typeof value.name !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(value.name)) {
    return invalid('name must use lowercase letters, numbers, underscores, or hyphens.');
  }
  if (!isRecord(value.manifest)) return invalid('manifest must be an object.');
  const manifestError = validateManifest(value.manifest);
  if (manifestError) return invalid(manifestError);
  if (!isRecord(value.graph)) return invalid('graph must be an object.');
  if (value.graph.schemaVersion !== 1) return invalid('graph.schemaVersion must be 1.');
  if (!Array.isArray(value.graph.nodes)) return invalid('graph.nodes must be an array.');
  if (!Array.isArray(value.graph.edges)) return invalid('graph.edges must be an array.');
  for (const [index, node] of value.graph.nodes.entries()) {
    const error = validateNode(node, index);
    if (error) return invalid(error);
  }
  for (const [index, edge] of value.graph.edges.entries()) {
    const error = validateEdge(edge, index);
    if (error) return invalid(error);
  }
  return { ok: true, document: value as unknown as WorkflowSourceDocument };
}

function validateManifest(manifest: Record<string, unknown>): string | null {
  for (const field of ['title', 'description', 'version', 'whenToUse'] as const) {
    if (manifest[field] !== undefined && typeof manifest[field] !== 'string') return `manifest.${field} must be a string.`;
  }
  if (manifest.tags !== undefined && (!Array.isArray(manifest.tags) || manifest.tags.some((tag) => typeof tag !== 'string'))) {
    return 'manifest.tags must be an array of strings.';
  }
  if (manifest.defaults !== undefined && !isRecord(manifest.defaults)) return 'manifest.defaults must be an object.';
  return null;
}

function validateNode(value: unknown, index: number): string | null {
  if (!isRecord(value)) return `graph.nodes[${index}] must be an object.`;
  if (typeof value.id !== 'string' || !value.id) return `graph.nodes[${index}].id must be a non-empty string.`;
  if (!['input', 'agent', 'decision', 'merge', 'output'].includes(String(value.kind))) {
    return `graph.nodes[${index}].kind is invalid.`;
  }
  if (typeof value.title !== 'string') return `graph.nodes[${index}].title must be a string.`;
  if (!isRecord(value.position) || !isFiniteNumber(value.position.x) || !isFiniteNumber(value.position.y)) {
    return `graph.nodes[${index}].position must contain finite x and y values.`;
  }
  if (!isRecord(value.config)) return `graph.nodes[${index}].config must be an object.`;
  return null;
}

function validateEdge(value: unknown, index: number): string | null {
  if (!isRecord(value)) return `graph.edges[${index}] must be an object.`;
  for (const field of ['id', 'source', 'target'] as const) {
    if (typeof value[field] !== 'string' || !value[field]) return `graph.edges[${index}].${field} must be a non-empty string.`;
  }
  if (value.sourcePort !== undefined && !['true', 'false', 'default'].includes(String(value.sourcePort))) {
    return `graph.edges[${index}].sourcePort is invalid.`;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function invalid(error: string): WorkflowSourceParseResult {
  return { ok: false, error };
}

function splitLines(source: string): string[] {
  const lines = source.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function buildBoundedDiff(left: string[], right: string[]): WorkflowSourceDiffLine[] {
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < left.length - prefix
    && suffix < right.length - prefix
    && left[left.length - suffix - 1] === right[right.length - suffix - 1]
  ) suffix += 1;
  return [
    ...left.slice(0, prefix).map((text, index) => ({ kind: 'same' as const, beforeLine: index + 1, afterLine: index + 1, text })),
    ...left.slice(prefix, left.length - suffix).map((text, index) => ({ kind: 'removed' as const, beforeLine: prefix + index + 1, text })),
    ...right.slice(prefix, right.length - suffix).map((text, index) => ({ kind: 'added' as const, afterLine: prefix + index + 1, text })),
    ...left.slice(left.length - suffix).map((text, index) => ({
      kind: 'same' as const,
      beforeLine: left.length - suffix + index + 1,
      afterLine: right.length - suffix + index + 1,
      text,
    })),
  ];
}
