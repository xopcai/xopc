import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock('../entry/src/main/ets/service/secureStore.ets', () => ({
  utf8: (text: string) => new TextEncoder().encode(text),
  XopcSecureStore: class {
    async read(key: string) { return mock.values.get(key); }
    async write(key: string, text: string) { mock.values.set(key, text); }
  }
}));

import { XopcChatSessionCache } from '../entry/src/main/ets/service/chatSessionCache.ets';

const item = (key: string) => ({ key, updatedAt: '2026-09-26T00:00:00Z', messageCount: 1, title: key });
const page = (key: string) => ({ items: [item(key)], total: 1, hasMore: false });

describe('bounded Gateway-scoped session list cache', () => {
  beforeEach(() => mock.values.clear());

  it('isolates Gateways and survives a cache instance restart', async () => {
    const cache = new XopcChatSessionCache();
    await cache.write('gateway-a', page('a')); await cache.write('gateway-b', page('b'));
    const restored = new XopcChatSessionCache();
    expect(await restored.read('gateway-a')).toEqual(page('a'));
    expect(await restored.read('gateway-b')).toEqual(page('b'));
  });

  it('ignores malformed data and removes only the requested Gateway', async () => {
    const cache = new XopcChatSessionCache();
    mock.values.set('chat-session-lists.v1', '[{"gatewayId":"gateway-a","savedAt":1,"page":{}}]');
    expect(await cache.read('gateway-a')).toBeUndefined();
    await cache.write('gateway-a', page('a')); await cache.write('gateway-b', page('b'));
    await cache.remove('gateway-a');
    expect(await cache.read('gateway-a')).toBeUndefined();
    expect(await cache.read('gateway-b')).toEqual(page('b'));
  });

  it('bounds the stored first-page snapshot to sixty sessions', async () => {
    const cache = new XopcChatSessionCache();
    const items = Array.from({ length: 75 }, (_value, index) => item(index.toString()));
    await cache.write('gateway-a', { items, total: 75, hasMore: false });
    const restored = await cache.read('gateway-a');
    expect(restored?.items).toHaveLength(60);
    expect(restored?.hasMore).toBe(true);
  });
});
