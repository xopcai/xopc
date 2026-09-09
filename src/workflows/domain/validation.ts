import type { WorkflowDefinition, WorkflowDefinitionManifest, WorkflowGraph, WorkflowGraphNode } from './definition.js';
import { buildWorkflowDefinition } from './definition-utils.js';

export type WorkflowDefinitionValidationIssueCode =
  | 'name_required'
  | 'invalid_name'
  | 'graph_required'
  | 'invalid_schema_version'
  | 'duplicate_node'
  | 'missing_input'
  | 'multiple_inputs'
  | 'missing_output'
  | 'multiple_outputs'
  | 'unknown_edge_node'
  | 'duplicate_edge'
  | 'self_edge'
  | 'cycle_detected'
  | 'unreachable_node'
  | 'dead_end_node'
  | 'missing_prompt'
  | 'invalid_manifest'
  | 'invalid_node_config';

export interface WorkflowDefinitionValidationIssue {
  code: WorkflowDefinitionValidationIssueCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
  field?: string;
}

export interface WorkflowDefinitionValidationResult {
  valid: boolean;
  errors: WorkflowDefinitionValidationIssue[];
  warnings: WorkflowDefinitionValidationIssue[];
  definition?: WorkflowDefinition;
}

export interface ValidateWorkflowDefinitionInput {
  name?: string;
  graph?: unknown;
  manifest?: unknown;
}

const NAME_RE = /^[a-z][a-z0-9_-]*$/;

export function validateWorkflowDefinitionInput(
  input: ValidateWorkflowDefinitionInput,
): WorkflowDefinitionValidationResult {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const errors: WorkflowDefinitionValidationIssue[] = [];
  const warnings: WorkflowDefinitionValidationIssue[] = [];

  if (!name) {
    errors.push({ code: 'name_required', message: 'Workflow name is required.', field: 'name' });
  } else if (!NAME_RE.test(name)) {
    errors.push({
      code: 'invalid_name',
      message: `Invalid workflow name "${name}". Use lowercase snake_case.`,
      field: 'name',
    });
  }

  const graph = isWorkflowGraphInput(input.graph) ? input.graph : undefined;
  if (!input.graph) {
    errors.push({ code: 'graph_required', message: 'Workflow graph is required.', field: 'graph' });
  } else if (!graph) {
    errors.push({ code: 'invalid_node_config', message: 'Workflow graph has an invalid structure.', field: 'graph' });
  } else {
    validateWorkflowGraph(graph, errors, warnings);
  }

  const manifest = validateManifest(input.manifest, errors);

  if (errors.length > 0 || !graph) return { valid: false, errors, warnings };

  return {
    valid: true,
    errors,
    warnings,
    definition: buildWorkflowDefinition({
      name,
      source: 'user',
      graph,
      manifest,
    }),
  };
}

function validateManifest(value: unknown, errors: WorkflowDefinitionValidationIssue[]): WorkflowDefinitionManifest | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push({ code: 'invalid_manifest', message: 'Workflow manifest must be an object.', field: 'manifest' });
    return undefined;
  }
  for (const field of ['title', 'description', 'version', 'whenToUse'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') {
      errors.push({ code: 'invalid_manifest', message: `Workflow manifest ${field} must be a string.`, field: `manifest.${field}` });
    }
  }
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string'))) {
    errors.push({ code: 'invalid_manifest', message: 'Workflow manifest tags must be strings.', field: 'manifest.tags' });
  }
  if (value.defaults !== undefined) {
    if (!isRecord(value.defaults)) {
      errors.push({ code: 'invalid_manifest', message: 'Workflow manifest defaults must be an object.', field: 'manifest.defaults' });
    } else {
      for (const field of ['concurrency', 'timeoutSec', 'maxSubagents'] as const) {
        const limit = value.defaults[field];
        if (limit !== undefined && (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1)) {
          errors.push({ code: 'invalid_manifest', message: `Workflow manifest ${field} must be a positive number.`, field: `manifest.defaults.${field}` });
        }
      }
    }
  }
  if (value.inputSchema !== undefined && !isRecord(value.inputSchema)) {
    errors.push({ code: 'invalid_manifest', message: 'Workflow inputSchema must be an object.', field: 'manifest.inputSchema' });
  }
  if (value.outputSchema !== undefined && !isRecord(value.outputSchema)) {
    errors.push({ code: 'invalid_manifest', message: 'Workflow outputSchema must be an object.', field: 'manifest.outputSchema' });
  }
  if (value.permissions !== undefined) {
    const permissions = value.permissions;
    if (!isRecord(permissions)
      || (permissions.tools !== undefined && (!Array.isArray(permissions.tools) || permissions.tools.some((tool) => typeof tool !== 'string')))
      || (permissions.network !== undefined && typeof permissions.network !== 'boolean')
      || (permissions.approvalRequired !== undefined && typeof permissions.approvalRequired !== 'boolean')
      || (permissions.fileSystem !== undefined && !['read', 'write', 'none'].includes(String(permissions.fileSystem)))) {
      errors.push({ code: 'invalid_manifest', message: 'Workflow permissions have an invalid structure.', field: 'manifest.permissions' });
    }
  }
  if (value.resources !== undefined) {
    const resources = value.resources;
    const stringListsValid = isRecord(resources) && ['skills', 'contextFiles', 'promptTemplates'].every((field) => (
      resources[field] === undefined || (Array.isArray(resources[field]) && resources[field].every((item) => typeof item === 'string'))
    ));
    if (!stringListsValid) errors.push({ code: 'invalid_manifest', message: 'Workflow resources have an invalid structure.', field: 'manifest.resources' });
  }
  if (value.connectors !== undefined && (!Array.isArray(value.connectors) || value.connectors.some((connector) => (
    !isRecord(connector)
    || typeof connector.connectorId !== 'string'
    || (connector.scope !== undefined && !['read', 'write', 'admin'].includes(String(connector.scope)))
    || (connector.connectionRequired !== undefined && typeof connector.connectionRequired !== 'boolean')
    || (connector.optional !== undefined && typeof connector.optional !== 'boolean')
    || (connector.reason !== undefined && typeof connector.reason !== 'string')
  )))) {
    errors.push({ code: 'invalid_manifest', message: 'Workflow connectors must contain connectorId strings.', field: 'manifest.connectors' });
  }
  return value as WorkflowDefinitionManifest;
}

function isWorkflowGraphInput(value: unknown): value is WorkflowGraph {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return false;
  const nodesValid = value.nodes.every((node) => isRecord(node)
    && typeof node.id === 'string'
    && typeof node.title === 'string'
    && ['input', 'agent', 'decision', 'merge', 'output'].includes(String(node.kind))
    && isRecord(node.position)
    && typeof node.position.x === 'number'
    && Number.isFinite(node.position.x)
    && typeof node.position.y === 'number'
    && Number.isFinite(node.position.y)
    && isRecord(node.config)
    && (node.kind !== 'agent' || typeof node.config.prompt === 'string')
    && (node.kind !== 'decision' || (
      isRecord(node.config.rule)
      && typeof node.config.rule.path === 'string'
      && ['exists', 'equals', 'not_equals', 'contains'].includes(String(node.config.rule.operator))
    ))
    && (node.kind !== 'merge' || ['array', 'object'].includes(String(node.config.mode))));
  const edgesValid = value.edges.every((edge) => isRecord(edge)
    && typeof edge.id === 'string'
    && typeof edge.source === 'string'
    && typeof edge.target === 'string');
  return nodesValid && edgesValid;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateWorkflowGraph(
  graph: WorkflowGraph,
  errors: WorkflowDefinitionValidationIssue[] = [],
  warnings: WorkflowDefinitionValidationIssue[] = [],
): WorkflowDefinitionValidationResult {
  if (graph.schemaVersion !== 1) {
    errors.push({
      code: 'invalid_schema_version',
      message: 'Workflow graph schemaVersion must be 1.',
      field: 'schemaVersion',
    });
  }

  const nodes = new Map<string, WorkflowGraphNode>();
  for (const node of graph.nodes) {
    if (nodes.has(node.id)) {
      errors.push({ code: 'duplicate_node', message: `Duplicate node id "${node.id}".`, nodeId: node.id });
      continue;
    }
    nodes.set(node.id, node);
    validateNode(node, errors);
  }

  const inputs = graph.nodes.filter((node) => node.kind === 'input');
  const outputs = graph.nodes.filter((node) => node.kind === 'output');
  if (inputs.length === 0) errors.push({ code: 'missing_input', message: 'Workflow needs one input node.' });
  if (inputs.length > 1) errors.push({ code: 'multiple_inputs', message: 'Workflow can only have one input node.' });
  if (outputs.length === 0) errors.push({ code: 'missing_output', message: 'Workflow needs one output node.' });
  if (outputs.length > 1) errors.push({ code: 'multiple_outputs', message: 'Workflow can only have one output node.' });

  const edgeKeys = new Set<string>();
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const indegree = new Map<string, number>(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    const key = `${edge.source}:${edge.target}:${edge.sourcePort ?? 'default'}`;
    if (edgeKeys.has(key)) {
      errors.push({ code: 'duplicate_edge', message: `Duplicate edge ${edge.source} → ${edge.target}.`, edgeId: edge.id });
    }
    edgeKeys.add(key);
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      errors.push({
        code: 'unknown_edge_node',
        message: `Edge "${edge.id}" references a missing node.`,
        edgeId: edge.id,
      });
      continue;
    }
    if (edge.source === edge.target) {
      errors.push({ code: 'self_edge', message: `Node "${edge.source}" cannot connect to itself.`, edgeId: edge.id });
      continue;
    }
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);

    const sourceNode = nodes.get(edge.source)!;
    if (sourceNode.kind === 'decision' && edge.sourcePort !== 'true' && edge.sourcePort !== 'false') {
      errors.push({ code: 'invalid_node_config', message: `Decision edge "${edge.id}" must use a true or false branch.`, edgeId: edge.id });
    }
    if (sourceNode.kind !== 'decision' && edge.sourcePort && edge.sourcePort !== 'default') {
      errors.push({ code: 'invalid_node_config', message: `Only decision nodes can use branch edges.`, edgeId: edge.id });
    }
  }

  if (nodes.size > 0 && !isAcyclic(indegree, outgoing)) {
    errors.push({ code: 'cycle_detected', message: 'Workflow graph must not contain a cycle.' });
  }

  if (inputs.length === 1) {
    const reachable = collectReachable(inputs[0].id, outgoing);
    for (const node of graph.nodes) {
      if (!reachable.has(node.id)) {
        errors.push({
          code: 'unreachable_node',
          message: `Node "${node.title}" is not connected to the workflow input.`,
          nodeId: node.id,
        });
      }
    }
  }

  if (outputs.length === 1) {
    const reachesOutput = collectReachable(outputs[0].id, incoming);
    for (const node of graph.nodes) {
      if (!reachesOutput.has(node.id)) {
        errors.push({ code: 'dead_end_node', message: `Node "${node.title}" does not lead to the workflow output.`, nodeId: node.id });
      }
    }
  }

  for (const node of graph.nodes) {
    if (node.kind !== 'decision') continue;
    const ports = graph.edges.filter((edge) => edge.source === node.id).map((edge) => edge.sourcePort);
    if (!ports.includes('true') || !ports.includes('false')) {
      errors.push({ code: 'invalid_node_config', message: `Decision node "${node.title}" needs both true and false branches.`, nodeId: node.id });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateNode(node: WorkflowGraphNode, errors: WorkflowDefinitionValidationIssue[]): void {
  if (!node.id.trim() || !node.title.trim()) {
    errors.push({
      code: 'invalid_node_config',
      message: 'Every node needs a stable id and title.',
      nodeId: node.id,
    });
  }
  if (node.kind === 'agent' && !node.config.prompt.trim()) {
    errors.push({
      code: 'missing_prompt',
      message: `Agent node "${node.title}" needs an instruction.`,
      nodeId: node.id,
      field: 'config.prompt',
    });
  }
  if (node.kind === 'agent' && node.config.maxIterations !== undefined) {
    if (!Number.isFinite(node.config.maxIterations) || node.config.maxIterations < 1) {
      errors.push({
        code: 'invalid_node_config',
        message: `Agent node "${node.title}" has an invalid iteration limit.`,
        nodeId: node.id,
        field: 'config.maxIterations',
      });
    }
  }
}

function isAcyclic(indegreeInput: Map<string, number>, outgoing: Map<string, string[]>): boolean {
  const indegree = new Map(indegreeInput);
  const queue = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited += 1;
    for (const target of outgoing.get(id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  return visited === indegree.size;
}

function collectReachable(start: string, outgoing: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(outgoing.get(id) ?? []));
  }
  return seen;
}
