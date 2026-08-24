import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchSessionMessagePage } from '../../../query/sessions';
import { fetchSessionAgentConfig } from '../../../query/models';
import { queryKeys } from '../../../query/keys';
import {
  prefetchSessionChatEntry,
  prefetchSessionHistoryHead,
} from '../session-history-prefetch';

vi.mock('../../../query/sessions', () => ({
  fetchSessionMessagePage: vi.fn(),
  emptySessionMessagePage: vi.fn((key: string) => ({
    session: { key, messages: [] },
    pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
  })),
}));

vi.mock('../../../query/models', () => ({
  fetchSessionAgentConfig: vi.fn(),
}));

const mockedFetchSessionMessagePage = vi.mocked(fetchSessionMessagePage);
const mockedFetchSessionAgentConfig = vi.mocked(fetchSessionAgentConfig);

describe('prefetchSessionHistoryHead', () => {
  beforeEach(() => {
    mockedFetchSessionMessagePage.mockReset();
    mockedFetchSessionAgentConfig.mockReset();
  });

  it('primes the exact infinite-query entry consumed by chat', async () => {
    const queryClient = new QueryClient();
    const page = {
      session: {
        key: 'session-1',
        messages: [{ role: 'assistant', content: 'ready' }],
      },
      pagination: {
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
      },
    };
    mockedFetchSessionMessagePage.mockResolvedValue(page);

    await prefetchSessionHistoryHead(queryClient, 'session-1', 'gateway-1');

    expect(mockedFetchSessionMessagePage).toHaveBeenCalledWith('session-1', {
      limit: 50,
      before: undefined,
    });
    expect(queryClient.getQueryData(
      queryKeys.sessionHistory('session-1', 'gateway-1'),
    )).toMatchObject({ pages: [page] });
  });

  it('primes history and presentation config as one chat entry', async () => {
    const queryClient = new QueryClient();
    mockedFetchSessionMessagePage.mockResolvedValue({
      session: { key: 'session-1', messages: [] },
      pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
    });
    mockedFetchSessionAgentConfig.mockResolvedValue({
      model: '',
      thinkingLevel: '',
      reasoningLevel: 'off',
      effectiveWorkspacePath: '',
      workingDirectoryLocked: false,
    });

    await prefetchSessionChatEntry(queryClient, 'session-1', 'gateway-1');

    expect(queryClient.getQueryData(
      queryKeys.sessionAgentConfig('session-1'),
    )).toMatchObject({ reasoningLevel: 'off' });
    expect(queryClient.getQueryData(
      queryKeys.sessionHistory('session-1', 'gateway-1'),
    )).toMatchObject({ pages: [expect.any(Object)] });
  });
});
