import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeSimple } from '@earendil-works/pi-ai/compat';

vi.mock('@earendil-works/pi-ai/compat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-ai/compat')>();
  return { ...actual, completeSimple: vi.fn() };
});

vi.mock('../../config/agent-typed-models.js', () => ({
  resolveModelRef: vi.fn(() => 'openai/gpt-test'),
}));

vi.mock('../../providers/index.js', () => ({
  getDefaultModelSync: vi.fn(() => 'openai/gpt-test'),
  getApiKey: vi.fn(async () => 'test-api-key'),
  resolveModel: vi.fn(() => ({ provider: 'openai', id: 'gpt-test', api: 'openai-completions' })),
}));

import { WorkflowDraftService } from '../draft/workflow-draft-service.js';

const validGraph = {
  schemaVersion: 1,
  nodes: [
    { id: 'input', kind: 'input', title: 'Input', position: { x: 0, y: 0 }, config: {} },
    { id: 'plan', kind: 'agent', title: 'Plan', position: { x: 300, y: 0 }, config: { prompt: 'Plan {{input.goal}}' } },
    { id: 'output', kind: 'output', title: 'Output', position: { x: 600, y: 0 }, config: {} },
  ],
  edges: [{ id: 'a', source: 'input', target: 'plan' }, { id: 'b', source: 'plan', target: 'output' }],
};

const invalidGraph = { ...validGraph, nodes: validGraph.nodes.filter((node) => node.kind !== 'output'), edges: validGraph.edges.slice(0, 1) };

function draftJson(graph: typeof validGraph): string {
  return JSON.stringify({
    name: 'daily_plan',
    graph,
    manifest: {
      title: 'Daily Plan',
      inputSchema: { type: 'object', properties: { goal: { type: 'string' } }, required: ['goal'] },
      outputSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
      permissions: { network: false, fileSystem: 'read', approvalRequired: false },
    },
    explanation: 'Creates a daily plan.',
    assumptions: [],
    risks: [],
  });
}

describe('WorkflowDraftService', () => {
  beforeEach(() => {
    vi.mocked(completeSimple).mockReset();
  });

  it('asks the model to repair invalid drafts and returns only the valid result', async () => {
    vi.mocked(completeSimple)
      .mockResolvedValueOnce({ role: 'assistant', content: [{ type: 'text', text: draftJson(invalidGraph) }] } as never)
      .mockResolvedValueOnce({ role: 'assistant', content: [{ type: 'text', text: draftJson(validGraph) }] } as never);

    const service = new WorkflowDraftService({ config: {} as never, maxRepairAttempts: 1 });
    const response = await service.createDraft({
      prompt: 'Create a planning workflow',
      agentId: 'main',
      constraints: { allowNetwork: false, fileSystem: 'read' },
    });

    expect(response.validation.valid).toBe(true);
    expect(response.repairAttempts).toBe(1);
    expect(completeSimple).toHaveBeenCalledTimes(2);
    expect((vi.mocked(completeSimple).mock.calls[1]?.[1] as { messages: Array<{ content: string }> }).messages[0]?.content)
      .toContain('missing_output');
  });

  it('fails with validation details when repair attempts are exhausted', async () => {
    vi.mocked(completeSimple).mockResolvedValue({
      role: 'assistant',
      content: [{ type: 'text', text: draftJson(invalidGraph) }],
    } as never);

    const service = new WorkflowDraftService({ config: {} as never, maxRepairAttempts: 1 });

    await expect(service.createDraft({ prompt: 'Create a planning workflow', agentId: 'main' }))
      .rejects.toThrow('Unable to generate a valid workflow draft after 2 attempts');
    expect(completeSimple).toHaveBeenCalledTimes(2);
  });
});
