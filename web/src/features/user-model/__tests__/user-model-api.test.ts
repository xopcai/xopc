import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchJson } = vi.hoisted(() => ({ fetchJson: vi.fn() }));

vi.mock('@/lib/fetch', () => ({ fetchJson }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));

import { fetchUserProfile, updatePriority } from '../user-model-api';

describe('user-model-api', () => {
  beforeEach(() => fetchJson.mockReset());

  it('preserves the local call-name suggestion returned by the gateway', async () => {
    fetchJson.mockResolvedValue({
      profile: {},
      suggestedCallName: 'Mic',
      assertions: [],
      goals: [],
      priorities: [],
      rules: [],
      knowledge: [],
      maintenance: { lastRun: null },
      counts: {
        activeAssertions: 0,
        reviewAssertions: 0,
        activeGoals: 0,
        activePriorities: 0,
        activeKnowledge: 0,
      },
    });

    await expect(fetchUserProfile()).resolves.toMatchObject({
      profile: { callName: '' },
      suggestedCallName: 'Mic',
    });
    expect(fetchJson).toHaveBeenCalledWith('/api/user-model');
  });

  it('updates the current priority through its typed endpoint', async () => {
    fetchJson.mockResolvedValue({ priority: { id: 'priority-1' } });

    await updatePriority('priority-1', {
      title: 'Ship the release',
      desiredOutcome: 'The release is live.',
      validTo: 42,
    });

    expect(fetchJson).toHaveBeenCalledWith('/api/user-model/priorities/priority-1', {
      method: 'PATCH',
      body: JSON.stringify({
        title: 'Ship the release',
        desiredOutcome: 'The release is live.',
        validTo: 42,
      }),
    });
  });
});
