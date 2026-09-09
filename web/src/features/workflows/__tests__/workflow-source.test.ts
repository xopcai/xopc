import { describe, expect, it } from 'vitest';

import type { WorkflowDefinition } from '../workflow-api';
import {
  buildWorkflowSourceDiff,
  parseWorkflowSourceDocument,
  serializeWorkflowSourceDocument,
  workflowDefinitionToSourceDocument,
} from '../workflow-source';

const definition: WorkflowDefinition = {
  id: 'review', name: 'review', title: 'Review', description: 'Review changes', version: '1.0.0', revision: 2,
  graph: { schemaVersion: 1, nodes: [
    { id: 'input', kind: 'input', title: 'Input', position: { x: 0, y: 0 }, config: {} },
    { id: 'agent', kind: 'agent', title: 'Review', position: { x: 1, y: 0 }, config: { prompt: 'Review' } },
    { id: 'output', kind: 'output', title: 'Output', position: { x: 2, y: 0 }, config: {} },
  ], edges: [
    { id: 'a', source: 'input', target: 'agent' },
    { id: 'b', source: 'agent', target: 'output' },
  ] },
  phases: [], defaults: { concurrency: 2, timeoutSec: 60, maxSubagents: 4 },
  connectors: [{ connectorId: 'github', scope: 'read' }],
  metadata: {
    tags: ['review'], builtIn: false, source: 'user', createdAtMs: 1, updatedAtMs: 2,
    examplePrompts: [{ field: 'goal', text: 'Review this PR' }],
    i18n: { zh: { description: '评审变更' } },
  },
};

describe('workflow source document', () => {
  it('round-trips every authoring field without system metadata', () => {
    const document = workflowDefinitionToSourceDocument(definition);
    const parsed = parseWorkflowSourceDocument(serializeWorkflowSourceDocument(document));

    expect(parsed).toEqual({ ok: true, document });
    expect(document.manifest.connectors).toEqual(definition.connectors);
    expect(document.manifest.examplePrompts).toEqual(definition.metadata.examplePrompts);
    expect(document.manifest.i18n).toEqual(definition.metadata.i18n);
    expect(document).not.toHaveProperty('revision');
  });

  it('rejects malformed graph values before the canvas can consume them', () => {
    const document = workflowDefinitionToSourceDocument(definition) as unknown as Record<string, unknown>;
    const graph = document.graph as { nodes: Array<Record<string, unknown>> };
    graph.nodes[0].position = { x: 'bad', y: 0 };

    expect(parseWorkflowSourceDocument(JSON.stringify(document))).toEqual({
      ok: false,
      error: 'graph.nodes[0].position must contain finite x and y values.',
    });
  });

  it('produces a line diff with stable source line numbers', () => {
    expect(buildWorkflowSourceDiff('a\nb\nc\n', 'a\nx\nc\n')).toEqual([
      { kind: 'same', beforeLine: 1, afterLine: 1, text: 'a' },
      { kind: 'removed', beforeLine: 2, text: 'b' },
      { kind: 'added', afterLine: 2, text: 'x' },
      { kind: 'same', beforeLine: 3, afterLine: 3, text: 'c' },
    ]);
  });
});
