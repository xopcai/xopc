import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../api/client';
import { fetchHome } from '../home';

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
}));

const mockedApiFetch = vi.mocked(apiFetch);

function currentGatewayHomeResponse() {
  return {
    runningConversations: [{
      conversationId: 'agent:main:webchat:default:direct:chat-1',
      runId: 'run-1',
      title: 'Plan the launch',
      agentId: 'main',
      updatedAt: 2,
    }],
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
    advisor: { state: 'quiet', reason: 'no_change' },
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
      runningConversations: [{ runId: 'run-1' }],
      needsUser: [{ kind: 'decision' }],
      background: [],
      backgroundCount: 0,
    });
    expect(home).not.toHaveProperty('recentlyOpened');
    expect(home).not.toHaveProperty('inboxCount');
    expect(mockedApiFetch).toHaveBeenCalledWith('/api/home?locale=en');
  });
  it('pairs approval details by approval identity rather than display order', async () => {
    const data = currentGatewayHomeResponse();
    const response = {
      ...data,
      needsUser: [{ ...data.needsUser[0], primaryAction: { type: 'connector_decision', label: 'Approve', approvalId: 'requested', decision: 'approve' } }],
      decisions: [
        { id: 'other', kind: 'connector_approval', title: 'Other', detail: 'Do not mix this request', reason: 'approval_required', urgency: 'now', href: '/connectors', updatedAt: 1, response: { kind: 'connector_approval', approvalId: 'other' } },
        { id: 'requested', kind: 'connector_approval', title: 'Requested', detail: 'Requested scope and target', reason: 'approval_required', urgency: 'now', href: '/connectors', updatedAt: 1, response: { kind: 'connector_approval', approvalId: 'requested' } },
      ],
    };
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify(response)));
    expect((await fetchHome('en')).needsUser[0].reviewDetail).toBe('Requested scope and target');
  });

});
