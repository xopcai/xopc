import { beforeEach, describe, expect, it, vi } from 'vitest';
import { complete } from '@earendil-works/pi-ai/compat';

vi.mock('@earendil-works/pi-ai/compat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-ai/compat')>();
  return { ...actual, complete: vi.fn() };
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

const validScript = `export const meta = {
  name: 'daily_plan',
  description: 'Create a daily plan.',
  phases: [{ title: 'Plan' }],
  tags: ['planning'],
  estimatedAgents: { min: 1, max: 1 },
}

phase('Plan')
const plan = await agent('Create a plan for ' + args.goal, { label: 'planner', maxIterations: 2 })
return { summary: String(plan), sections: [{ kind: 'text', title: 'Plan', content: String(plan) }] }
`;

const invalidScript = validScript.replace("name: 'daily_plan'", "name: 'wrong_name'");

function draftJson(script: string): string {
  return JSON.stringify({
    name: 'daily_plan',
    script,
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
    vi.mocked(complete).mockReset();
  });

  it('asks the model to repair invalid drafts and returns only the valid result', async () => {
    vi.mocked(complete)
      .mockResolvedValueOnce({ role: 'assistant', content: [{ type: 'text', text: draftJson(invalidScript) }] } as never)
      .mockResolvedValueOnce({ role: 'assistant', content: [{ type: 'text', text: draftJson(validScript) }] } as never);

    const service = new WorkflowDraftService({ config: {} as never, maxRepairAttempts: 1 });
    const response = await service.createDraft({
      prompt: 'Create a planning workflow',
      agentId: 'main',
      constraints: { allowNetwork: false, fileSystem: 'read' },
    });

    expect(response.validation.valid).toBe(true);
    expect(response.repairAttempts).toBe(1);
    expect(complete).toHaveBeenCalledTimes(2);
    expect((vi.mocked(complete).mock.calls[1]?.[1] as { messages: Array<{ content: string }> }).messages[0]?.content)
      .toContain('meta_name_mismatch');
  });

  it('fails with validation details when repair attempts are exhausted', async () => {
    vi.mocked(complete).mockResolvedValue({
      role: 'assistant',
      content: [{ type: 'text', text: draftJson(invalidScript) }],
    } as never);

    const service = new WorkflowDraftService({ config: {} as never, maxRepairAttempts: 1 });

    await expect(service.createDraft({ prompt: 'Create a planning workflow', agentId: 'main' }))
      .rejects.toThrow('Unable to generate a valid workflow draft after 2 attempts');
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
