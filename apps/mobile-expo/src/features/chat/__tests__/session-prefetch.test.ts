import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../stores/gateway-store', () => ({
  useGatewayStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({
      refreshActiveBaseUrl: vi.fn().mockResolvedValue(undefined),
    })),
  }),
}));

vi.mock('../../../query/sessions', () => ({
  createSession: vi.fn(),
}));

vi.mock('../../../query/models', () => ({
  setSessionInitialAgentConfig: vi.fn(),
}));

import { createSession } from '../../../query/sessions';
import {
  prefetchNewChatSession,
  resetSessionPrefetchCacheForTests,
  takeNewChatSessionKey,
} from '../session-prefetch';

const mockedCreate = vi.mocked(createSession);

beforeEach(() => {
  resetSessionPrefetchCacheForTests();
  mockedCreate.mockReset();
  mockedCreate.mockImplementation(async (input = {}) => {
    const id = (input.agentId ?? 'main').trim().toLowerCase() || 'main';
    return `agent:${id}:webchat:default:direct:server-owned`;
  });
});

afterEach(() => {
  resetSessionPrefetchCacheForTests();
});

describe('server session prefetch', () => {
  it('takes a server-created session key', async () => {
    await expect(takeNewChatSessionKey({ agentId: 'main', projectId: null })).resolves.toBe(
      'agent:main:webchat:default:direct:server-owned',
    );
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(mockedCreate).toHaveBeenCalledWith({ agentId: 'main' });
  });

  it('prefetch then take reuses the prefetched server key', async () => {
    prefetchNewChatSession({ agentId: 'main', projectId: null });
    await expect(takeNewChatSessionKey({ agentId: 'main', projectId: null })).resolves.toBe(
      'agent:main:webchat:default:direct:server-owned',
    );
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it('different agents cache independently', async () => {
    prefetchNewChatSession({ agentId: 'main', projectId: null });
    prefetchNewChatSession({ agentId: 'other', projectId: null });

    await expect(takeNewChatSessionKey({ agentId: 'main', projectId: null })).resolves.toBe(
      'agent:main:webchat:default:direct:server-owned',
    );
    await expect(takeNewChatSessionKey({ agentId: 'other', projectId: null })).resolves.toBe(
      'agent:other:webchat:default:direct:server-owned',
    );
    expect(mockedCreate).toHaveBeenCalledTimes(2);
  });

  it('keeps explicit execution environments in separate cache entries', async () => {
    prefetchNewChatSession({ agentId: 'main', projectId: 'project-1', executionMode: 'local_checkout' });
    await takeNewChatSessionKey({ agentId: 'main', projectId: 'project-1', executionMode: 'managed_worktree' });

    expect(mockedCreate).toHaveBeenCalledWith({ agentId: 'main', projectId: 'project-1', executionMode: 'local_checkout' });
    expect(mockedCreate).toHaveBeenCalledWith({ agentId: 'main', projectId: 'project-1', executionMode: 'managed_worktree' });
  });
});
