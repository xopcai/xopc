import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { fetchHome } from '../home';

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
}));

const mockedApiFetch = vi.mocked(apiFetch);

function currentGatewayHomeResponse() {
  return {
    needsUser: [{
      id: 'decision:approval',
      kind: 'decision',
      title: 'Approve connector access',
      summary: 'A connector needs permission.',
      updatedAt: 1,
      primaryAction: { type: 'open', label: 'Review', href: '/connectors' },
      secondaryActions: [],
    }],
    background: [],
    backgroundCount: 0,
    decisions: [],
    attentionPolicy: {
      visibleDecisionCount: 0,
      suppressedDecisionCount: 0,
      visibleAttentionCount: 0,
      suppressedAttentionCount: 0,
    },
    recentlyOpened: [],
    inboxCount: 0,
  };
}

describe('fetchHome', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('returns only the mobile home read model', async () => {
    mockedApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => currentGatewayHomeResponse(),
    } as Response);

    const home = await fetchHome('en');

    expect(home).toMatchObject({
      needsUser: [{ kind: 'decision' }],
      background: [],
      backgroundCount: 0,
    });
    expect(home).not.toHaveProperty('recentlyOpened');
    expect(home).not.toHaveProperty('inboxCount');
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/home?locale=en');
  });
});
