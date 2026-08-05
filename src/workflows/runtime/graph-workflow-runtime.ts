import { availableParallelism } from 'node:os';

import type { Api, Model } from '@earendil-works/pi-ai';

import type {
  WorkflowAgentNode,
  WorkflowDecisionNode,
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphNode,
} from '../domain/definition.js';
import { validateWorkflowGraph } from '../domain/validation.js';

import type { WorkflowAgentInvocationSnapshot, WorkflowAgentStatus } from '../../agent/workflow/types.js';
import type {
  WorkflowRuntime,
  WorkflowRuntimeDeps,
  WorkflowRuntimeRunOptions,
  WorkflowRuntimeRunResult,
} from './workflow-runtime-port.js';

const MAX_CONCURRENCY = 16;

export class GraphWorkflowRuntime implements WorkflowRuntime {
  async run<T = unknown>(
    graph: WorkflowGraph,
    deps: WorkflowRuntimeDeps,
    options: WorkflowRuntimeRunOptions,
  ): Promise<WorkflowRuntimeRunResult<T>> {
    const startedAtMs = Date.now();
    const validation = validateWorkflowGraph(graph);
    if (!validation.valid) throw new Error(validation.errors.map((issue) => issue.message).join(' '));

    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const incoming = indexEdges(graph.edges, 'target');
    const pending = new Set(graph.nodes.map((node) => node.id));
    const completed = new Set<string>();
    const skipped = new Set<string>();
    const outputs = new Map<string, unknown>();
    const decisions = new Map<string, boolean>();
    const logs: string[] = [];
    const phases: string[] = [];
    let currentPhase: string | undefined;
    let agentCount = 0;
    const maxSubagents = Math.max(1, options.maxSubagents ?? 100);
    const limiter = createLimiter(resolveConcurrency(options.concurrency));

    const throwIfAborted = () => {
      if (!options.signal?.aborted) return;
      const reason = options.signal.reason;
      throw reason instanceof Error ? reason : new Error(reason ? String(reason) : 'workflow aborted');
    };

    while (pending.size > 0) {
      throwIfAborted();
      let progressed = false;

      for (const nodeId of [...pending]) {
        const edges = incoming.get(nodeId) ?? [];
        if (edges.length === 0 || !edges.every((edge) => completed.has(edge.source) || skipped.has(edge.source))) continue;
        if (edges.some((edge) => !skipped.has(edge.source) && isActiveEdge(edge, nodes, decisions))) continue;
        pending.delete(nodeId);
        skipped.add(nodeId);
        const skippedNode = nodes.get(nodeId)!;
        options.onNodeEnd?.({ nodeId, kind: skippedNode.kind, title: skippedNode.title, status: 'skipped' });
        progressed = true;
      }

      const ready = [...pending]
        .map((id) => nodes.get(id)!)
        .filter((node) => {
          const edges = incoming.get(node.id) ?? [];
          if (edges.length === 0) return node.kind === 'input';
          const active = edges.filter((edge) => !skipped.has(edge.source) && isActiveEdge(edge, nodes, decisions));
          return active.length > 0 && active.every((edge) => completed.has(edge.source));
        });

      if (ready.length === 0) {
        if (progressed) continue;
        throw new Error('workflow graph stalled before all nodes could run');
      }

      await Promise.all(ready.map((node) => limiter(async () => {
        throwIfAborted();
        options.onNodeStart?.({ nodeId: node.id, kind: node.kind, title: node.title });
        try {
          if (node.phaseId && node.phaseId !== currentPhase) {
            currentPhase = node.phaseId;
            if (!phases.includes(node.phaseId)) phases.push(node.phaseId);
            options.onPhase?.(node.phaseId);
          }

          const predecessors = (incoming.get(node.id) ?? [])
            .filter((edge) => !skipped.has(edge.source) && isActiveEdge(edge, nodes, decisions))
            .map((edge) => ({ id: edge.source, value: outputs.get(edge.source) }));
          let value: unknown;
          if (node.kind === 'input') {
            value = options.args ?? {};
          } else if (node.kind === 'agent') {
            if (agentCount >= maxSubagents) throw new Error(`workflow agent quota exhausted (max ${maxSubagents})`);
            agentCount += 1;
            value = await runAgentNode({
              id: agentCount,
              node,
              deps,
              options,
              outputs,
              predecessors,
              goal: options.goal,
              signal: options.signal,
            });
          } else if (node.kind === 'decision') {
            const candidate = predecessors.at(-1)?.value;
            const result = evaluateDecision(node, candidate);
            decisions.set(node.id, result);
            value = { result, input: candidate };
          } else if (node.kind === 'merge') {
            value = node.config.mode === 'array'
              ? predecessors.map((entry) => entry.value)
              : Object.fromEntries(predecessors.map((entry) => [entry.id, entry.value]));
          } else {
            const outputData = predecessors.length === 1
              ? predecessors[0].value
              : Object.fromEntries(predecessors.map((entry) => [entry.id, entry.value]));
            const summary = node.config.summary
              ? renderTemplate(node.config.summary, options.args, outputs, predecessors, options.goal)
              : renderResultContent(outputData);
            value = {
              summary,
              ...(typeof outputData === 'string' ? {} : { data: outputData }),
            };
          }
          outputs.set(node.id, value);
          pending.delete(node.id);
          completed.add(node.id);
          options.onNodeEnd?.({ nodeId: node.id, kind: node.kind, title: node.title, status: 'done', result: value });
        } catch (error) {
          options.onNodeEnd?.({
            nodeId: node.id,
            kind: node.kind,
            title: node.title,
            status: options.signal?.aborted ? 'skipped' : 'error',
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      })));
    }

    const outputNode = graph.nodes.find((node) => node.kind === 'output');
    return {
      result: outputs.get(outputNode!.id) as T,
      logs,
      phases,
      agentCount,
      durationMs: Date.now() - startedAtMs,
    };
  }
}

export function createGraphWorkflowRuntime(): WorkflowRuntime {
  return new GraphWorkflowRuntime();
}

async function runAgentNode(params: {
  id: number;
  node: WorkflowAgentNode;
  deps: WorkflowRuntimeDeps;
  options: WorkflowRuntimeRunOptions;
  outputs: Map<string, unknown>;
  predecessors: Array<{ id: string; value: unknown }>;
  goal?: string;
  signal?: AbortSignal;
}): Promise<unknown> {
  const { node } = params;
  const prompt = renderTemplate(node.config.prompt, params.options.args, params.outputs, params.predecessors, params.goal);
  const model = resolveModel(node.config.model, params.deps.resolveModelId);
  const invocation: WorkflowAgentInvocationSnapshot = {
    nodeId: node.id,
    prompt,
    label: node.title,
    phase: node.phaseId,
    modelRef: node.config.model,
    resolvedModelRef: model ? `${model.provider}/${model.id}` : undefined,
    schema: node.config.outputSchema,
    toolset: node.config.toolset,
    maxIterations: node.config.maxIterations,
  };
  params.options.onAgentQueued?.({ id: params.id, nodeId: node.id, label: node.title, phase: node.phaseId, prompt, invocation });
  params.options.onAgentStart?.({ id: params.id, nodeId: node.id, label: node.title, phase: node.phaseId, prompt });
  try {
    const enhanced = params.options.enhanceSubagentRun?.({ id: params.id, nodeId: node.id, label: node.title, phase: node.phaseId, prompt });
    const result = await params.deps.runner.run(prompt, {
      label: node.title,
      schema: node.config.outputSchema,
      allowedToolNames: node.config.toolset,
      maxIterations: node.config.maxIterations,
      model,
      phase: node.phaseId,
      signal: params.signal,
      ...enhanced,
    });
    if (result === null) throw new Error(`workflow node '${node.title}' did not return a result`);
    const status: WorkflowAgentStatus = 'done';
    params.options.onAgentEnd?.({ id: params.id, nodeId: node.id, label: node.title, phase: node.phaseId, result, status });
    return result;
  } catch (error) {
    const status: WorkflowAgentStatus = params.signal?.aborted ? 'skipped' : 'error';
    params.options.onAgentEnd?.({ id: params.id, nodeId: node.id, label: node.title, phase: node.phaseId, result: null, status });
    throw error;
  }
}

function resolveModel(modelRef: string | undefined, resolver: WorkflowRuntimeDeps['resolveModelId']): Model<Api> | undefined {
  if (!modelRef) return undefined;
  if (!resolver) throw new Error('workflow runtime cannot resolve the selected model');
  return resolver(modelRef);
}

export function renderWorkflowTemplate(
  template: string,
  input: unknown,
  outputs: Map<string, unknown>,
  predecessors: Array<{ id: string; value: unknown }>,
  goal?: string,
): string {
  return renderTemplate(template, input, outputs, predecessors, goal);
}

function renderTemplate(template: string, input: unknown, outputs: Map<string, unknown>, predecessors: Array<{ id: string; value: unknown }>, goal?: string): string {
  const context = { input, goal, nodes: Object.fromEntries(outputs), predecessors: Object.fromEntries(predecessors.map((entry) => [entry.id, entry.value])) };
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path: string) => stringifyTemplateValue(readPath(context, path)));
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function stringifyTemplateValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function evaluateDecision(node: WorkflowDecisionNode, value: unknown): boolean {
  const candidate = node.config.rule.path ? readPath(value, node.config.rule.path) : value;
  if (node.config.rule.operator === 'exists') return candidate !== undefined && candidate !== null;
  if (node.config.rule.operator === 'equals') return Object.is(candidate, node.config.rule.value);
  if (node.config.rule.operator === 'not_equals') return !Object.is(candidate, node.config.rule.value);
  return Array.isArray(candidate) ? candidate.includes(node.config.rule.value) : String(candidate ?? '').includes(String(node.config.rule.value ?? ''));
}

function isActiveEdge(edge: WorkflowGraphEdge, nodes: Map<string, WorkflowGraphNode>, decisions: Map<string, boolean>): boolean {
  if (nodes.get(edge.source)?.kind !== 'decision') return true;
  if (!decisions.has(edge.source)) return false;
  if (!edge.sourcePort || edge.sourcePort === 'default') return true;
  return edge.sourcePort === (decisions.get(edge.source) ? 'true' : 'false');
}

function indexEdges(edges: WorkflowGraphEdge[], field: 'source' | 'target'): Map<string, WorkflowGraphEdge[]> {
  const result = new Map<string, WorkflowGraphEdge[]>();
  for (const edge of edges) result.set(edge[field], [...(result.get(edge[field]) ?? []), edge]);
  return result;
}

function resolveConcurrency(requested?: number): number {
  if (requested && Number.isFinite(requested)) return Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(requested)));
  return Math.max(1, Math.min(MAX_CONCURRENCY, availableParallelism() - 2));
}

function createLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    active += 1;
    try { return await work(); } finally { active -= 1; queue.shift()?.(); }
  };
}

function renderResultContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['content', 'summary', 'executiveSummary', 'result', 'answer']) {
      if (typeof record[key] === 'string') return record[key].trim();
    }
  }
  return 'Workflow completed.';
}
