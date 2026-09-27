import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  request: vi.fn(), read: vi.fn(), save: vi.fn(), remove: vi.fn(), readCommand: vi.fn(),
  saveCommand: vi.fn(), clearCommand: vi.fn(), uuid: vi.fn(), turnClaim: vi.fn(), scope: 'gateway:device',
}));

vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: {
  request: mock.request, currentProfile: () => undefined, connectionRevision: () => 0, assertConnection: () => {},
} }));
vi.mock('../entry/src/main/ets/service/realtimeClient.ets', () => ({ realtimeClient: { turnClaim: mock.turnClaim } }));
vi.mock('../entry/src/main/ets/service/deviceCrypto.ets', () => ({ XopcDeviceCrypto: class { uuid() { return mock.uuid(); } } }));
vi.mock('../entry/src/main/ets/service/secureStore.ets', () => ({ XopcSecureStore: class {} }));
vi.mock('../entry/src/main/ets/service/chatHistoryCache.ets', () => ({ chatHistoryCache: { revision: () => 0 } }));
vi.mock('../entry/src/main/ets/service/localSessionStore.ets', () => ({ localSessionStore: {
  scope: () => mock.scope,
  read: mock.read, save: mock.save, remove: mock.remove, readCommand: mock.readCommand,
  saveCommand: mock.saveCommand, clearCommand: mock.clearCommand,
} }));
vi.mock('../entry/src/main/ets/service/transport.ets', () => ({ XopcHttpError: class extends Error { status: number = 500; body: string = ''; } }));

import { XopcChatRepository } from '../entry/src/main/ets/repository/chatRepository.ets';
import { XopcHttpError } from '../entry/src/main/ets/service/transport.ets';

const creation = { agentId: 'main', projectId: null, execution: null, temporary: false, model: 'provider/model', thinkingLevel: 'off' };
const draft = () => ({ conversationId: 'draft-1', creation: { ...creation }, createdAt: '2026-09-27T00:00:00.000Z' });
const response = (clientMessageId: string, activeRunId = 'run-1') => JSON.stringify({ payload: {
  receipt: { conversationId: 'draft-1', clientMessageId, transcriptId: 'transcript-1', lifecycle: 'ready' },
  session: { key: 'draft-1', transcriptId: 'transcript-1', messages: [] }, agentConfig: {}, inputState: { activeRunId },
} });

describe('local-first session creation', () => {
  it('unfreezes a rejected first input and permits changing the model', async () => {
    const local = draft(); mock.read.mockResolvedValue(local);
    const error = new XopcHttpError(400, '');
    error.status = 400; error.body = JSON.stringify({ error: { code: 'BAD_REQUEST' } });
    mock.request.mockRejectedValueOnce(error);
    const repository = new XopcChatRepository();
    await expect(repository.send('draft-1', 'hello', 'message-1')).rejects.toBe(error);
    expect(local).not.toHaveProperty('command', expect.anything());
    await expect(repository.setModel('draft-1', 'provider/other')).resolves.toBeUndefined();
    expect(mock.clearCommand).toHaveBeenCalledWith('draft-1', 'gateway:device');
  });
  it('cleans up only the initiating identity after switching during an awaited write', async () => {
    mock.scope = 'gateway:device';
    mock.read.mockResolvedValue(draft()); mock.request.mockResolvedValue(response('message-1'));
    mock.clearCommand.mockImplementationOnce(async () => { mock.scope = 'other:device'; });
    await new XopcChatRepository().send('draft-1', 'hello', 'message-1');
    expect(mock.remove).toHaveBeenCalledWith('draft-1', 'gateway:device');
  });
  beforeEach(() => {
    vi.resetAllMocks(); mock.scope = 'gateway:device'; mock.uuid.mockReturnValue('draft-1'); mock.read.mockResolvedValue(undefined);
    mock.save.mockResolvedValue(undefined); mock.remove.mockResolvedValue(undefined);
    mock.readCommand.mockResolvedValue(undefined);
    mock.saveCommand.mockImplementation(async (_id, command) => { mock.readCommand.mockResolvedValue(command); });
    mock.clearCommand.mockImplementation(async () => { mock.readCommand.mockResolvedValue(undefined); });
    mock.turnClaim.mockReturnValue({ type: 'endpoint', endpointId: 'phone', token: 'claim' });
  });

  it('creates a durable local draft without an eager Gateway session', async () => {
    const id = await new XopcChatRepository().create('project-1', 'writer', 'worktree');
    expect(id).toBe('draft-1');
    expect(mock.save).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'draft-1', creation: {
      agentId: 'writer', projectId: 'project-1', execution: { mode: 'worktree' }, temporary: false, model: '', thinkingLevel: 'off',
    } }), 'gateway:device');
    expect(mock.request).not.toHaveBeenCalled();
  });

  it('atomically starts the persisted draft with its first input', async () => {
    const local = draft(); mock.read.mockResolvedValue(local); mock.request.mockResolvedValue(response('message-1'));
    const runId = await new XopcChatRepository().send('draft-1', 'hello', 'message-1');
    expect(runId).toBe('run-1');
    expect(mock.save).toHaveBeenCalledWith(expect.objectContaining({ command: expect.objectContaining({
      kind: 'start', clientMessageId: 'message-1', creation, input: { content: 'hello' },
    }) }), 'gateway:device');
    expect(mock.request).toHaveBeenCalledWith('/api/sessions/draft-1/inputs', 'POST', expect.any(String));
    expect(JSON.parse(mock.request.mock.calls[0][2])).toMatchObject({
      kind: 'start', clientMessageId: 'message-1', origin: { endpointId: 'phone' },
    });
    expect(mock.remove).toHaveBeenCalledWith('draft-1', 'gateway:device');
  });

  it('reuses the persisted first-input identity after an ambiguous failure', async () => {
    const local = draft(); mock.read.mockResolvedValue(local);
    mock.request.mockRejectedValueOnce(new Error('NETWORK')).mockResolvedValueOnce(response('message-1'));
    const repository = new XopcChatRepository();
    await expect(repository.send('draft-1', 'hello', 'message-1')).rejects.toThrow('NETWORK');
    await expect(repository.send('draft-1', 'hello', 'message-2')).rejects.toThrow('INPUT_PENDING');
    await expect(repository.send('draft-1', 'hello', 'message-1')).resolves.toBe('run-1');
    const commands = mock.request.mock.calls.map((call) => JSON.parse(call[2]));
    expect(commands.map((command) => command.clientMessageId)).toEqual(['message-1', 'message-1']);
    await expect(repository.send('draft-1', 'changed', 'message-3')).rejects.toThrow('FIRST_INPUT_PENDING');
  });

  it('materializes a configured draft before voice or session-resource work', async () => {
    const local = draft(); mock.read.mockResolvedValue(local); mock.uuid.mockReturnValue('materialize-1');
    mock.request.mockResolvedValue(response('materialize-1', ''));
    await new XopcChatRepository().materialize('draft-1', 'voice');
    expect(mock.save).toHaveBeenCalledWith(expect.objectContaining({
      materialization: { commandId: 'materialize-1', purpose: 'voice' },
    }), 'gateway:device');
    expect(mock.request).toHaveBeenCalledWith('/api/sessions/draft-1/materialize', 'POST', expect.any(String));
    expect(mock.remove).toHaveBeenCalledWith('draft-1', 'gateway:device');
  });
});
