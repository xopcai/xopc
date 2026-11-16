import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ request: vi.fn(), currentProfile: vi.fn(), cacheWrite: vi.fn() }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mock.request,
  currentProfile: mock.currentProfile,
  connectionRevision: () => 0, assertConnection: () => {} } }));
vi.mock('../entry/src/main/ets/service/chatSessionCache.ets', () => ({ chatSessionCache: { write: mock.cacheWrite } }));
vi.mock('../entry/src/main/ets/service/realtimeClient.ets', () => ({ realtimeClient: {} }));
vi.mock('../entry/src/main/ets/service/deviceCrypto.ets', () => ({ XopcDeviceCrypto: class {} }));
vi.mock('../entry/src/main/ets/service/secureStore.ets', () => ({ XopcSecureStore: class {} }));
vi.mock('../entry/src/main/ets/service/transport.ets', () => ({ XopcHttpError: class extends Error { status: number = 500; } }));
vi.mock('../entry/src/main/ets/service/localSessionStore.ets', () => ({ localSessionStore: {
  read: vi.fn().mockResolvedValue(undefined), readCommand: vi.fn().mockResolvedValue(undefined),
  save: vi.fn(), saveCommand: vi.fn(), clearCommand: vi.fn(), remove: vi.fn(),
} }));
import { XopcChatRepository } from '../entry/src/main/ets/repository/chatRepository.ets';
describe('session manager Gateway requests', () => {
  beforeEach(() => { vi.resetAllMocks(); mock.request.mockResolvedValue(JSON.stringify({ items: [], total: 0, hasMore: false })); });
  it('preserves the default webchat query and allows queries across channels', async () => {
    const repo = new XopcChatRepository(); await repo.list(); await repo.list('  中文 & ?  ', 20, 20, '');
    const paths = mock.request.mock.calls.map(call => new URL(call[0], 'https://gateway.invalid'));
    expect(paths[0].searchParams.get('channel')).toBe('webchat');
    expect(paths[1].searchParams.has('channel')).toBe(false);
    expect(Object.fromEntries(paths[1].searchParams)).toEqual({ limit: '20', offset: '20', sortBy: 'updatedAt', sortOrder: 'desc', search: '中文 & ?' });
  });
  it('fills sidebar recents across pages when the first page has only two usable sessions', async () => {
    mock.currentProfile.mockReturnValue({ gatewayId: 'gateway', deviceId: 'device' });
    const row = (key: string, messageCount = 1, status = 'active') =>
      ({ key, messageCount, status, updatedAt: '2026-11-17T00:00:00Z' });
    const personal = row('personal');
    const first = row('one');
    const older = ['two', 'three', 'four', 'five', 'six'].map(key => row(key));
    mock.request
      .mockResolvedValueOnce(JSON.stringify({ items: [personal, row('empty', 0), first, row('archived', 1, 'archived')],
        total: 12, hasMore: true }))
      .mockResolvedValueOnce(JSON.stringify({ items: [first, ...older], total: 12, hasMore: true }));
    mock.cacheWrite.mockResolvedValue(undefined);

    const page = await new XopcChatRepository().refreshRecent();

    expect(page.items).toEqual([personal, first, ...older]);
    expect(mock.request.mock.calls.map(([path]) =>
      Object.fromEntries(new URL(path, 'https://gateway.invalid').searchParams))).toEqual(
      ['0', '4'].map(offset => ({ limit: '20', offset, rootConversationsOnly: 'true', excludeArchived: 'true',
        excludeAutomationRuns: 'true', sortBy: 'updatedAt', sortOrder: 'desc', search: '' })));
    expect(mock.cacheWrite).toHaveBeenCalledWith('gateway', 'device', page);
  });
  it('combines scoped history filters and search on the Gateway', async () => {
    const repo = new XopcChatRepository();
    await repo.historyList('term', 20, { projectId: 'id/a?' });
    await repo.historyList('', 0, { unassigned: true });
    await repo.historyList('term', 0, { expertId: 'expert' });
    const [project, inbox, expert] = mock.request.mock.calls.map(call =>
      Object.fromEntries(new URL(call[0], 'https://gateway.invalid').searchParams));
    expect(project).toMatchObject({ projectId: 'id/a?', search: 'term', offset: '20',
      excludeArchived: 'true', excludeAutomationRuns: 'true' });
    expect(inbox).toMatchObject({ unassigned: 'true', rootConversationsOnly: 'true' });
    expect(expert).toMatchObject({ agentId: 'expert', sources: 'workbench', purposes: 'chat',
      activity: 'manual', excludeArchived: 'true', rootConversationsOnly: 'true', search: 'term' });
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
