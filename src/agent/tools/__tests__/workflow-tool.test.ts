import { describe, expect, it, vi } from 'vitest';

import { createWorkflowTool } from '../workflow-tool.js';

describe('workflow tool async run start', () => {
  it('starts a persisted run and returns runId + sessionKey immediately', async () => {
    const startWorkflowRun = vi.fn(async () => ({
      ok: true as const,
      runId: 'run-1',
      sessionKey: 'agent:main:webchat:default:direct:wf_run-1',
    }));
    const catalog = {
      load: vi.fn(),
      save: vi.fn(),
    };

    const tool = createWorkflowTool({
      catalog: catalog as never,
      getConfig: () => ({}) as never,
      getCurrentSessionKey: () => 'agent:main:webchat:default:direct:parent',
      startWorkflowRun,
    });

    const result = await tool.execute('tool-call-1', { name: 'audit_repo', goal: 'Check repo' });

    expect(startWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        definitionId: 'audit_repo',
        goal: 'Check repo',
        parentSessionKey: 'agent:main:webchat:default:direct:parent',
        source: { kind: 'chat', sessionKey: 'agent:main:webchat:default:direct:parent' },
      }),
    );
    expect(result.details).toMatchObject({
      runId: 'run-1',
      sessionKey: 'agent:main:webchat:default:direct:wf_run-1',
      delivery: {
        operation: 'started',
        primary: {
          kind: 'workflow_run',
          id: 'run-1',
        },
      },
    });
    expect(result.content[0]?.type).toBe('text');
  });

  it('returns unavailable when workflow run service is missing', async () => {
    const tool = createWorkflowTool({
      catalog: { load: vi.fn() } as never,
      getConfig: () => ({}) as never,
    });

    const result = await tool.execute('tool-call-1', { name: 'audit_repo' });
    expect(result.details).toMatchObject({ error: 'workflow_run_unavailable' });
  });

  it('uses an explicit workflow and otherwise uses the default', async () => {
    const startWorkflowRun = vi.fn(async () => ({
      ok: true as const,
      runId: 'run-1',
      sessionKey: 'agent:main:workflow:run-1',
    }));
    const catalog = { load: vi.fn() };
    const config = {
      agents: {
        default: 'main',
        defaults: {
          models: { chat: { primary: 'openai/gpt-4.1', fallbacks: [] }, intents: {} },
          workflows: { default: 'general', allowed: ['general', 'review-code'] },
        },
        list: [{
          id: 'main',
          enabled: true,
          profile: { name: 'Main' },
          workspace: '/tmp/main',
        }],
      },
    };
    const tool = createWorkflowTool({
      catalog: catalog as never,
      getConfig: () => config as never,
      getCurrentSessionKey: () => 'agent:main:webchat:default:direct:parent',
      startWorkflowRun,
    });

    await tool.execute('explicit', { name: 'review-code' });
    await tool.execute('default', {});

    expect(startWorkflowRun.mock.calls[0]?.[0].definitionId).toBe('review-code');
    expect(startWorkflowRun.mock.calls[1]?.[0].definitionId).toBe('general');
  });
});
