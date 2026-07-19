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
  readCachedSessionHistoryHead,
  writeCachedSessionHistoryHead,
} from '../session-history-cache';

function page(sessionKey: string, text: string): SessionMessagePage {
  return {
    session: {
      key: sessionKey,
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
  it('keeps the same session key isolated between gateways', () => {
    const sessionKey = 'agent:main:webchat:default:direct:shared';
    writeCachedSessionHistoryHead('gateway-a', sessionKey, page(sessionKey, 'from a'));
    writeCachedSessionHistoryHead('gateway-b', sessionKey, page(sessionKey, 'from b'));

    expect(readCachedSessionHistoryHead('gateway-a', sessionKey)?.session.messages[0]?.content)
      .toBe('from a');
    expect(readCachedSessionHistoryHead('gateway-b', sessionKey)?.session.messages[0]?.content)
      .toBe('from b');
  });

  it('does not expose cached history without a gateway identity', () => {
    const sessionKey = 'agent:main:webchat:default:direct:shared';
    writeCachedSessionHistoryHead('gateway-a', sessionKey, page(sessionKey, 'cached'));

    expect(readCachedSessionHistoryHead(null, sessionKey)).toBeNull();
  });
});
