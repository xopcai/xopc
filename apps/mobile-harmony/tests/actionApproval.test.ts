import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ values: new Map<string, string>(), drafts: new Map<string, any>(), gateway: 'a', request: vi.fn(), nextId: 0 }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: {
  request: mock.request, currentProfile: () => ({ gatewayId: mock.gateway }), connectionRevision: () => 1, assertConnection: vi.fn(),
} }));
vi.mock('../entry/src/main/ets/service/secureStore.ets', () => ({ XopcSecureStore: class {
  async read(key: string) { return mock.values.get(key); }
  async write(key: string, text: string) { mock.values.set(key, text); }
} }));
vi.mock('../entry/src/main/ets/service/deviceCrypto.ets', () => ({ XopcDeviceCrypto: class { uuid() { return `draft-${++mock.nextId}`; } } }));
vi.mock('../entry/src/main/ets/service/realtimeClient.ets', () => ({ realtimeClient: {} }));
vi.mock('../entry/src/main/ets/service/chatHistoryCache.ets', () => ({ chatHistoryCache: {} }));
vi.mock('../entry/src/main/ets/service/transport.ets', () => ({ XopcHttpError: class extends Error {} }));
vi.mock('../entry/src/main/ets/service/localSessionStore.ets', () => ({ localSessionStore: {
  scope: () => mock.gateway, read: async (id: string) => mock.drafts.get(id),
  save: async (draft: any) => { mock.drafts.set(draft.conversationId, structuredClone(draft)); },
} }));
import { XopcChatRepository } from '../entry/src/main/ets/repository/chatRepository.ets';

describe('device-local action approval preference', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mock.values.clear(); mock.drafts.clear(); mock.gateway = 'a';
    mock.request.mockResolvedValue(JSON.stringify({ payload: { config: { runtime: { actionApprovalMode: 'ask' } } } }));
  });
  it('inherits only explicit saves and isolates Gateways and Agents across repository restarts', async () => {
    const repo = new XopcChatRepository(); const first = await repo.create(undefined, 'main');
    expect((await repo.config(first)).actionApprovalMode).toBe('ask');
    await repo.setActionApproval(first, 'main', 'full');
    const restored = new XopcChatRepository();
    expect((await restored.config(await restored.create(undefined, 'main'))).actionApprovalMode).toBe('full');
    expect((await restored.config(await restored.create(undefined, 'research'))).actionApprovalMode).toBe('ask');
    mock.gateway = 'b';
    expect((await restored.config(await restored.create(undefined, 'main'))).actionApprovalMode).toBe('ask');
  });
  it('does not remember failed changes or overwrite defaults when opening an old chat', async () => {
    const repo = new XopcChatRepository(); mock.values.set('chat-permissions.a.main', 'ask');
    mock.request.mockResolvedValueOnce(JSON.stringify({ payload: { actionApprovalMode: 'full', configVersion: 3 } }));
    expect((await repo.config('old')).actionApprovalMode).toBe('full');
    expect(mock.values.get('chat-permissions.a.main')).toBe('ask');
    mock.request.mockRejectedValueOnce(new Error('HTTP_403'));
    await expect(repo.setActionApproval('old', 'main', 'full', 3)).rejects.toThrow('HTTP_403');
    expect(mock.values.get('chat-permissions.a.main')).toBe('ask');
  });
  it('uses Agent defaults then ask and freezes in-flight drafts', async () => {
    const repo = new XopcChatRepository();
    mock.request.mockResolvedValueOnce(JSON.stringify({ payload: { config: { runtime: { actionApprovalMode: 'full' } } } }));
    const id = await repo.create(undefined, 'main'); expect((await repo.config(id)).actionApprovalMode).toBe('full');
    mock.drafts.get(id).materialization = { commandId: 'voice', purpose: 'voice' };
    await expect(repo.setActionApproval(id, 'main', 'ask')).rejects.toThrow('FIRST_INPUT_PENDING');
    expect(mock.values.has('chat-permissions.a.main')).toBe(false);
    mock.request.mockRejectedValueOnce(new Error('offline'));
    expect((await repo.config(await repo.create(undefined, 'other'))).actionApprovalMode).toBe('ask');
  });
  it('sends a dedicated versioned permission patch', async () => {
    mock.request.mockResolvedValueOnce(JSON.stringify({ payload: { actionApprovalMode: 'full', configVersion: 5 } }));
    await new XopcChatRepository().setActionApproval('existing', 'main', 'full', 4);
    expect(JSON.parse(mock.request.mock.calls[0][2])).toEqual({ actionApprovalMode: 'full', configVersion: 4 });
    expect(mock.values.get('chat-permissions.a.main')).toBe('full');
  });
});
