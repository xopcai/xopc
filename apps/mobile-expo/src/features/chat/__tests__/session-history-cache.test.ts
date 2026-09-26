import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

vi.mock('../../../storage/mmkv', () => ({
  KEYS: { queryCachePrefix: 'gateway.queryCache:' },
  storage: {
    getString: (key: string) => memory.get(key),
    set: (key: string, value: string | number | boolean) => {
      memory.set(key, String(value));
    },
    delete: (key: string) => {
      memory.delete(key);
    },
  },
}));

import type { SessionMessagePage } from '../../../query/sessions';
import {
  readCachedSessionHistoryPage,
  readCachedSessionHistoryHead,
  writeCachedSessionHistoryPage,
  writeCachedSessionHistoryHead,
} from '../session-history-cache';

function page(conversationId: string, text: string, transcriptId = 'transcript-a'): SessionMessagePage {
  return {
    session: {
      key: conversationId,
      transcriptId,
      messages: [{ role: 'user', content: text }],
    },
    pagination: {
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
    },
  };
}

beforeEach(() => {
  memory.clear();
});

describe('session history head cache', () => {
  it('retains an old snapshot for immediate offline rendering after a later cold start', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      writeCachedSessionHistoryHead('gateway-a', 'saved', page('saved', 'offline history'));
      clock.mockReturnValue(1000 + 2 * 24 * 60 * 60 * 1000);
      expect(readCachedSessionHistoryHead('gateway-a', 'saved')?.session.messages[0]?.content).toBe('offline history');
    } finally { clock.mockRestore(); }
  });
  it('keeps the same session key isolated between gateways', () => {
    const conversationId = 'agent:main:webchat:default:direct:shared';
    writeCachedSessionHistoryHead('gateway-a', conversationId, page(conversationId, 'from a'));
    writeCachedSessionHistoryHead('gateway-b', conversationId, page(conversationId, 'from b'));

    expect(readCachedSessionHistoryHead('gateway-a', conversationId)?.session.messages[0]?.content)
      .toBe('from a');
    expect(readCachedSessionHistoryHead('gateway-b', conversationId)?.session.messages[0]?.content)
      .toBe('from b');
  });

  it('does not expose cached history without a gateway identity', () => {
    const conversationId = 'agent:main:webchat:default:direct:shared';
    writeCachedSessionHistoryHead('gateway-a', conversationId, page(conversationId, 'cached'));

    expect(readCachedSessionHistoryHead(null, conversationId)).toBeNull();
  });

  it('persists immutable older pages and isolates them by transcript and cursor', () => {
    writeCachedSessionHistoryPage('gateway-a', 'saved', '50', page('saved', 'older', 'transcript-a'));

    expect(readCachedSessionHistoryPage('gateway-a', 'saved', 'transcript-a', '50')?.session.messages[0]?.content)
      .toBe('older');
    expect(readCachedSessionHistoryPage('gateway-a', 'saved', 'transcript-b', '50')).toBeNull();
    expect(readCachedSessionHistoryPage('gateway-a', 'saved', 'transcript-a', '100')).toBeNull();
  });
});
