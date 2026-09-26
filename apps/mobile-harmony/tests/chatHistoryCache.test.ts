import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ values: new Map<string, string>(), write: vi.fn() }));
vi.mock('../entry/src/main/ets/service/secureStore.ets', () => ({ utf8: (text: string) => new TextEncoder().encode(text), XopcSecureStore: class {
  async read(key: string) { return mock.values.get(key); }
  async write(key: string, text: string) { mock.write(key, text); mock.values.set(key, text); }
} }));
import { XopcChatHistoryCache } from '../entry/src/main/ets/service/chatHistoryCache.ets';
const page = (key = 'c', content = 'saved') => ({ session: { key, transcriptId: 't', messages: [{ id: 'm', role: 'user', content }] }, pagination: { hasMore: false } });
describe('bounded secure history heads', () => {
  beforeEach(() => { mock.values.clear(); mock.write.mockClear(); });
  it('isolates Gateways and conversations and survives a cache instance restart', async () => {
    const cache = new XopcChatHistoryCache(); await cache.write('g1', 'c', page()); await cache.write('g2', 'c', page('c', 'other'));
    const restored = new XopcChatHistoryCache(); expect(await restored.read('g1', 'c')).toEqual(page());
    expect(await restored.read('g2', 'c')).toEqual(page('c', 'other')); expect(await restored.read('g1', 'missing')).toBeUndefined();
  });
  it('ignores malformed and mismatched snapshots', async () => {
    const cache = new XopcChatHistoryCache();
    for (const raw of ['bad-json', '{}', '[null]', '[{"gatewayId":"g","conversationId":"c","page":{}}]']) {
      mock.values.set('chat-history-heads.v1', raw); expect(await cache.read('g', 'c')).toBeUndefined();
    }
    await cache.write('g', 'c', page('wrong')); expect(mock.write).not.toHaveBeenCalled();
  });
  it('bounds UTF-8 storage and invalidates rather than truncate oversized messages', async () => {
    const cache = new XopcChatHistoryCache(); await cache.write('g', 'c', page());
    await cache.write('g', 'c', page('c', '中'.repeat(20000))); expect(await cache.read('g', 'c')).toBeUndefined();
    for (let i = 0; i < 12; i++) await cache.write('g', String(i), page(String(i), '中'.repeat(2500)));
    expect(await cache.read('g', '0')).toBeUndefined(); expect(await cache.read('g', '11')).toBeDefined();
    expect(new TextEncoder().encode(mock.values.get('chat-history-heads.v1')!).length).toBeLessThanOrEqual(48 * 1024);
  });
  it('serializes writes, snapshots inputs, and clears only the requested scope', async () => {
    const cache = new XopcChatHistoryCache(); const original = page();
    const writing = cache.write('g1', 'c', original); original.session.messages[0].content = 'changed'; await writing;
    expect((await cache.read('g1', 'c'))?.session.messages[0].content).toBe('saved');
    await Promise.all([cache.write('g1', 'd', page('d')), cache.write('g2', 'c', page())]);
    await cache.remove('g1', 'c'); expect(await cache.read('g1', 'c')).toBeUndefined(); expect(await cache.read('g1', 'd')).toBeDefined();
    await cache.remove('g1'); expect(await cache.read('g1', 'd')).toBeUndefined(); expect(await cache.read('g2', 'c')).toBeDefined();
  });
  it('does not rewrite an identical network head', async () => {
    const cache = new XopcChatHistoryCache(); await cache.write('g', 'c', page()); await cache.write('g', 'c', page());
    expect(mock.write).toHaveBeenCalledOnce();
  });
  it('persists immutable older pages by transcript and cursor', async () => {
    const cache = new XopcChatHistoryCache();
    await cache.writePage('g', 'c', 't', 'before-1', page());
    const restored = new XopcChatHistoryCache();
    expect(await restored.readPage('g', 'c', 't', 'before-1')).toEqual(page());
    expect(await restored.readPage('g', 'c', 'other', 'before-1')).toBeUndefined();
    expect(await restored.readPage('g', 'c', 't', 'before-2')).toBeUndefined();
  });
  it('bounds older pages and clears them with their conversation', async () => {
    const cache = new XopcChatHistoryCache();
    for (let i = 0; i < 24; i++) await cache.writePage('g', 'c', 't', 'before-' + i, page('c', String(i)));
    expect(await cache.readPage('g', 'c', 't', 'before-0')).toBeUndefined();
    expect(await cache.readPage('g', 'c', 't', 'before-23')).toBeDefined();
    await cache.remove('g', 'c');
    expect(await cache.readPage('g', 'c', 't', 'before-23')).toBeUndefined();
  });
});
