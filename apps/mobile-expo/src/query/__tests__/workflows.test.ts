import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { fetchWorkflowRun, fetchWorkflowRuns } from '../workflows';

vi.mock('../../api/client', () => ({ apiFetch: vi.fn() }));

const mockedApiFetch = vi.mocked(apiFetch);
const summary = {
  id: 'run-1',
  definitionId: 'research',
  title: 'Research topic',
  status: 'running',
  createdAtMs: 1,
  metrics: {
    agentCount: 2,
    doneAgentCount: 1,
    errorAgentCount: 0,
    skippedAgentCount: 0,
    artifactCount: 0,
  },
};

describe('workflow queries', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('parses current workflow run summaries', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({ runs: [summary] }), { status: 200 }));
    await expect(fetchWorkflowRuns()).resolves.toEqual([summary]);
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/workflows/runs?limit=50');
  });

  it('aggregates runs across enabled agents and retains their owner', async () => {
    mockedApiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ runs: [summary] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ runs: [{ ...summary, id: 'run-2', createdAtMs: 2 }] }), { status: 200 }));
    await expect(fetchWorkflowRuns(['agent-a', 'agent-b'])).resolves.toEqual([
      expect.objectContaining({ id: 'run-2', ownerAgentId: 'agent-b' }),
      expect.objectContaining({ id: 'run-1', ownerAgentId: 'agent-a' }),
    ]);
    expect(mockedApiFetch).toHaveBeenNthCalledWith(1, '/api/workflows/runs?limit=50&agentId=agent-a');
    expect(mockedApiFetch).toHaveBeenNthCalledWith(2, '/api/workflows/runs?limit=50&agentId=agent-b');
  });

  it('encodes workflow run ids and preserves gateway errors', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Workflow run not found' }), { status: 404 }));
    await expect(fetchWorkflowRun('run/1')).rejects.toThrow('Workflow run not found');
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/workflows/runs/run%2F1');
  });
});
