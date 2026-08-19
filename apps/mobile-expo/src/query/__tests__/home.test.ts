import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { fetchHome } from '../home';

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
}));

const mockedApiFetch = vi.mocked(apiFetch);

function currentGatewayHomeResponse() {
  return {
    briefing: {
      generatedAt: 1,
      summary: 'All clear',
      focus: [],
      progress: {
        activeWorkflowCount: 0,
        activeTaskCount: 0,
        movingCount: 0,
      },
      wins: [],
    },
    decisions: [],
    attention: [],
    attentionPolicy: {
      visibleDecisionCount: 0,
      suppressedDecisionCount: 0,
      visibleAttentionCount: 0,
      suppressedAttentionCount: 0,
    },
    chats: { running: [], recent: [] },
    recentlyOpened: [],
    inboxCount: 0,
    pendingTasks: [],
    pendingTaskCount: 0,
    recentSessions: [],
    activeAgent: { id: 'main' },
    gateway: {
      status: 'running',
      ready: true,
      httpListening: true,
      uptime: 1,
      tunnel: { state: 'disabled', connected: false },
    },
    workflowRuns: { active: [], recent: [] },
    tasks: { running: [] },
    upcomingAutomations: [],
    recentTasks: [],
  };
}

describe('fetchHome', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('accepts the current gateway response after focus fields moved out of home', async () => {
    mockedApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => currentGatewayHomeResponse(),
    } as Response);

    await expect(fetchHome('en')).resolves.toMatchObject({
    });
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/home?locale=en');
  });
});
