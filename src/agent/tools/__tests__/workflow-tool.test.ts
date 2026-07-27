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
});
