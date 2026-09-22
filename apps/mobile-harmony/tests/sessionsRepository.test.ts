import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mock.request, currentProfile: () => undefined,
  connectionRevision: () => 0, assertConnection: () => {} } }));
vi.mock('../entry/src/main/ets/service/realtimeClient.ets', () => ({ realtimeClient: {} }));
vi.mock('../entry/src/main/ets/service/deviceCrypto.ets', () => ({ XopcDeviceCrypto: class {} }));
vi.mock('../entry/src/main/ets/service/secureStore.ets', () => ({ XopcSecureStore: class {} }));
import { XopcChatRepository } from '../entry/src/main/ets/repository/chatRepository.ets';
describe('session manager Gateway requests', () => {
  beforeEach(() => { vi.resetAllMocks(); mock.request.mockResolvedValue(JSON.stringify({ items: [], total: 0, hasMore: false })); });
  it('preserves drawer webchat filtering but omits channel for the full manager', async () => {
    const repo = new XopcChatRepository(); await repo.list(); await repo.list('  中文 & ?  ', 20, 20, '');
    const paths = mock.request.mock.calls.map(call => new URL(call[0], 'https://gateway.invalid'));
    expect(paths[0].searchParams.get('channel')).toBe('webchat');
    expect(paths[1].searchParams.has('channel')).toBe(false);
    expect(Object.fromEntries(paths[1].searchParams)).toEqual({ limit: '20', offset: '20', sortBy: 'updatedAt', sortOrder: 'desc', search: '中文 & ?' });
  });
  it('rejects malformed pages before the list accesses row properties', async () => {
    for (const payload of [{}, { items: [null], hasMore: false }, { items: [{ key: 'a' }], hasMore: true }]) {
      mock.request.mockResolvedValueOnce(JSON.stringify(payload));
      await expect(new XopcChatRepository().list()).rejects.toThrow('INVALID_SESSION_LIST');
    }
  });
  it('encodes stable conversation ids and uses the existing action API without new routes', async () => {
    const repo = new XopcChatRepository(); await repo.rename('id/a?', 'Renamed'); await repo.action('id/a?', 'delete'); await repo.action('id/a?', 'unarchive');
    expect(mock.request.mock.calls).toEqual([
      ['/api/sessions/id%2Fa%3F/rename', 'POST', '{"name":"Renamed"}'],
      ['/api/sessions/id%2Fa%3F', 'DELETE', '{}'],
      ['/api/sessions/id%2Fa%3F/unarchive', 'POST', '{}'],
    ]);
    await expect(repo.action('id', 'arbitrary')).rejects.toThrow('INVALID_ACTION');
  });
});
