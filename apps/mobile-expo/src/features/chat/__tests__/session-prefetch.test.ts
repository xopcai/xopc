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
  mockedCreate.mockImplementation(async (agentId) => {
    const id = (agentId ?? 'main').trim().toLowerCase() || 'main';
    return `agent:${id}:webchat:default:direct:server-owned`;
  });
});

afterEach(() => {
  resetSessionPrefetchCacheForTests();
});

describe('server session prefetch', () => {
  it('takes a server-created session key', async () => {
    await expect(takeNewChatSessionKey('main')).resolves.toBe(
      'agent:main:webchat:default:direct:server-owned',
    );
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(mockedCreate).toHaveBeenCalledWith('main');
  });

  it('prefetch then take reuses the prefetched server key', async () => {
    prefetchNewChatSession('main');
    await expect(takeNewChatSessionKey('main')).resolves.toBe(
      'agent:main:webchat:default:direct:server-owned',
    );
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it('different agents cache independently', async () => {
    prefetchNewChatSession('main');
    prefetchNewChatSession('other');

    await expect(takeNewChatSessionKey('main')).resolves.toBe(
      'agent:main:webchat:default:direct:server-owned',
    );
    await expect(takeNewChatSessionKey('other')).resolves.toBe(
      'agent:other:webchat:default:direct:server-owned',
    );
    expect(mockedCreate).toHaveBeenCalledTimes(2);
  });
});
