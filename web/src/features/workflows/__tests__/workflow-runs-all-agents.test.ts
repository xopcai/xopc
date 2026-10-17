import { describe, expect, it, vi } from 'vitest';

import { fetchJson } from '@/lib/fetch';
import { listWorkflowRunsForAgents } from '../workflow-api';

vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => `http://localhost${path}` }));
vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn(), apiFetch: vi.fn() }));

describe('all-assistant workflow runs', () => {
  it('merges runs by recency with a global limit and preserves ownership and project scope', async () => {
    vi.mocked(fetchJson).mockImplementation(async (url) => {
      const params = new URL(String(url), 'http://localhost').searchParams;
      expect(params.get('projectId')).toBe('project-1');
      return { runs: params.get('agentId') === 'main'
        ? [{ id: 'old', createdAtMs: 1 }, { id: 'middle', createdAtMs: 5 }]
        : [{ id: 'new', createdAtMs: 9 }] };
    });
    const runs = await listWorkflowRunsForAgents(['main', 'writer', 'main'], 2, { projectId: 'project-1' });
    expect(runs.map((run) => [run.id, run.ownerAgentId])).toEqual([['new', 'writer'], ['middle', 'main']]);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('does not silently hide a failed assistant query', async () => {
    vi.mocked(fetchJson).mockRejectedValueOnce(new Error('Unavailable'));
    await expect(listWorkflowRunsForAgents(['writer'])).rejects.toThrow('Unavailable');
  });
});
