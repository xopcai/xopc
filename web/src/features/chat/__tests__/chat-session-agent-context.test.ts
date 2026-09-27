import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveChatSessionAgentContext } from '@/features/chat/session/chat-session-agent-context';
import { readLocalSessionDraft } from '@/features/chat/session/local-session-drafts';
import { getSessionDetail } from '@/features/sessions/session-api';

vi.mock('@/features/chat/session/local-session-drafts', () => ({
  readLocalSessionDraft: vi.fn(),
}));

vi.mock('@/features/sessions/session-api', () => ({
  getSessionDetail: vi.fn(),
}));

const readDraft = vi.mocked(readLocalSessionDraft);
const readSession = vi.mocked(getSessionDetail);

describe('resolveChatSessionAgentContext', () => {
  beforeEach(() => {
    readDraft.mockReset();
    readSession.mockReset();
  });

  it('uses the selected agent stored on a local draft before it reaches the Gateway', async () => {
    readDraft.mockResolvedValue({
      conversationId: 'draft-1',
      createdAt: '2026-09-27T00:00:00.000Z',
      creation: {
        agentId: ' Reviewer ',
        projectId: 'project-a',
        execution: null,
        temporary: false,
        model: '',
        thinkingLevel: 'off',
      },
    });

    await expect(resolveChatSessionAgentContext('draft-1')).resolves.toEqual({
      agentId: 'reviewer',
      projectId: 'project-a',
    });
    expect(readSession).not.toHaveBeenCalled();
  });

  it('falls back to the persisted top-level agent id when routing metadata is absent', async () => {
    readDraft.mockResolvedValue(undefined);
    readSession.mockResolvedValue({
      key: 'session-1',
      agentId: 'Coder',
      status: 'active',
      tags: [],
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:00.000Z',
      lastAccessedAt: '2026-09-27T00:00:00.000Z',
      messageCount: 0,
      estimatedTokens: 0,
      compactedCount: 0,
      sourceChannel: 'webchat',
      sourceChatId: 'chat-1',
      messages: [],
    });

    await expect(resolveChatSessionAgentContext('session-1')).resolves.toEqual({
      agentId: 'coder',
      projectId: null,
    });
  });
});
