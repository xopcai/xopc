import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { fetchHome } from '../home';

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
}));

const mockedApiFetch = vi.mocked(apiFetch);

function currentGatewayHomeResponse() {
  return {
    focusItems: [{
      id: 'suggestion:ask-agent',
      kind: 'suggestion',
      priority: 10,
      title: 'What would you like to move forward?',
      summary: 'Hand me the outcome you want.',
      updatedAt: 1,
      pinnable: false,
      primaryAction: { type: 'ask_ai', label: 'Ask an agent' },
      secondaryActions: [],
    }],
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

  it('returns only the mobile home read model', async () => {
    mockedApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => currentGatewayHomeResponse(),
    } as Response);

    const home = await fetchHome('en');

    expect(home).toMatchObject({
      focusItems: [{ kind: 'suggestion' }],
      chats: { running: [], recent: [] },
      tasks: { running: [] },
    });
    expect(home).not.toHaveProperty('recentSessions');
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/home?locale=en');
  });
});
