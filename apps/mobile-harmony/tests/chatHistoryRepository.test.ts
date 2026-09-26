import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ gateway: 'g', connection: 0, revision: 0, request: vi.fn(), readPage: vi.fn(), write: vi.fn(), writePage: vi.fn(), remove: vi.fn() }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: {
  request: mock.request, currentProfile: () => ({ gatewayId: mock.gateway }), connectionRevision: () => mock.connection,
  assertConnection: (revision: number) => { if (revision !== mock.connection) throw new Error('GATEWAY_CHANGED'); },
} }));
vi.mock('../entry/src/main/ets/service/realtimeClient.ets', () => ({ realtimeClient: {} }));
vi.mock('../entry/src/main/ets/service/deviceCrypto.ets', () => ({ XopcDeviceCrypto: class {} }));
vi.mock('../entry/src/main/ets/service/secureStore.ets', () => ({ XopcSecureStore: class {} }));
vi.mock('../entry/src/main/ets/service/chatHistoryCache.ets', () => ({ chatHistoryCache: {
  revision: () => mock.revision, readPage: mock.readPage, write: mock.write, writePage: mock.writePage,
  remove: (...args: unknown[]) => { mock.revision++; return mock.remove(...args); },
} }));
import { XopcChatRepository } from '../entry/src/main/ets/repository/chatRepository.ets';
const page = { session: { key: 'c', transcriptId: 't', messages: [] }, pagination: { hasMore: false } };
describe('history cache mutation fences', () => {
  beforeEach(() => { vi.resetAllMocks(); mock.gateway = 'g'; mock.connection = 0; mock.revision = 0; mock.request.mockResolvedValue(JSON.stringify(page)); });
  it('remembers only a fetched head from the same Gateway', async () => {
    const repo = new XopcChatRepository(); const head = await repo.history('c');
    await repo.rememberHistory('c', head); expect(mock.write).toHaveBeenCalledWith('g', 'c', page);
    mock.write.mockClear(); mock.gateway = 'other'; await repo.rememberHistory('c', head); expect(mock.write).not.toHaveBeenCalled();
  });
  it('persists older pages only under their transcript and cursor', async () => {
    const repo = new XopcChatRepository(); const older = await repo.history('c', 'cursor', 't');
    expect(mock.writePage).toHaveBeenCalledWith('g', 'c', 't', 'cursor', older);
    await repo.rememberHistory('c', older); await repo.rememberHistory('c', page); expect(mock.write).not.toHaveBeenCalled();
  });
  it('serves a matching immutable older page without a network request', async () => {
    mock.readPage.mockResolvedValueOnce(page);
    const result = await new XopcChatRepository().history('c', 'cursor', 't');
    expect(result).toBe(page); expect(mock.request).not.toHaveBeenCalled();
  });
  it('does not reuse an older page after the Gateway changes during cache access', async () => {
    mock.readPage.mockImplementationOnce(async () => { mock.connection++; return page; });
    await expect(new XopcChatRepository().history('c', 'cursor', 't')).rejects.toThrow('GATEWAY_CHANGED');
    expect(mock.request).not.toHaveBeenCalled();
  });
  it('rejects a head fetched before another repository resets the conversation', async () => {
    const repo = new XopcChatRepository(); const head = await repo.history('c');
    await new XopcChatRepository().action('c', 'reset'); await repo.rememberHistory('c', head);
    expect(mock.write).not.toHaveBeenCalled(); expect(mock.remove).toHaveBeenCalledTimes(2);
  });
  it('invalidates again even if the mutation response fails', async () => {
    mock.request.mockRejectedValueOnce(new Error('AMBIGUOUS_RESPONSE'));
    await expect(new XopcChatRepository().action('c', 'delete')).rejects.toThrow('AMBIGUOUS_RESPONSE');
    expect(mock.remove).toHaveBeenCalledTimes(2);
  });
  it('does not send a mutation after a Gateway change during invalidation', async () => {
    mock.remove.mockImplementationOnce(async () => { mock.connection++; mock.gateway = 'other'; });
    await expect(new XopcChatRepository().action('c', 'delete')).rejects.toThrow('GATEWAY_CHANGED');
    expect(mock.request).not.toHaveBeenCalled();
  });
});
