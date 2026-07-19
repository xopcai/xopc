import { describe, expect, it } from 'vitest';

import type { WorkflowGraph } from '../domain/definition.js';
import { validateWorkflowDefinitionInput, validateWorkflowGraph } from '../domain/validation.js';

const validGraph: WorkflowGraph = {
  schemaVersion: 1,
  nodes: [
    { id: 'input', kind: 'input', title: 'Input', position: { x: 0, y: 0 }, config: {} },
    { id: 'agent', kind: 'agent', title: 'Analyze', phaseId: 'work', position: { x: 300, y: 0 }, config: { prompt: 'Analyze {{input}}' } },
    { id: 'output', kind: 'output', title: 'Output', position: { x: 600, y: 0 }, config: {} },
  ],
  edges: [
    { id: 'input-agent', source: 'input', target: 'agent' },
    { id: 'agent-output', source: 'agent', target: 'output' },
  ],
};

describe('workflow graph validation', () => {
  it('builds a definition preview from a valid graph', () => {
    const result = validateWorkflowDefinitionInput({ name: 'demo_workflow', graph: validGraph });
    expect(result.valid).toBe(true);
    expect(result.definition?.graph).toEqual(validGraph);
    expect(result.definition?.phases[0]?.id).toBe('work');
  });

  it('requires a name and graph', () => {
    expect(validateWorkflowDefinitionInput({ name: '', graph: validGraph }).errors[0]?.code).toBe('name_required');
    expect(validateWorkflowDefinitionInput({ name: 'demo' }).errors[0]?.code).toBe('graph_required');
  });

  it('reports multiple structural problems at once', () => {
    const graph: WorkflowGraph = {
      schemaVersion: 1,
      nodes: [
        { id: 'input', kind: 'input', title: 'Input', position: { x: 0, y: 0 }, config: {} },
        { id: 'orphan', kind: 'agent', title: 'Orphan', position: { x: 0, y: 0 }, config: { prompt: '' } },
      ],
      edges: [{ id: 'bad', source: 'missing', target: 'orphan' }],
    };
    const result = validateWorkflowGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual(expect.arrayContaining(['missing_output', 'unknown_edge_node', 'unreachable_node', 'missing_prompt']));
  });

  it('rejects cycles', () => {
    const graph = structuredClone(validGraph);
    graph.edges.push({ id: 'cycle', source: 'agent', target: 'input' });
    expect(validateWorkflowGraph(graph).errors.some((issue) => issue.code === 'cycle_detected')).toBe(true);
  });
});
