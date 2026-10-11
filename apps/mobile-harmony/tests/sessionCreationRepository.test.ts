import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  request: vi.fn(), read: vi.fn(), save: vi.fn(), remove: vi.fn(), readCommand: vi.fn(),
  saveCommand: vi.fn(), clearCommand: vi.fn(), uuid: vi.fn(), turnClaim: vi.fn(), assertConnection: vi.fn(), scope: 'gateway:device',
}));

vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: {
  request: mock.request, currentProfile: () => undefined, connectionRevision: () => 0, assertConnection: mock.assertConnection,
} }));
vi.mock('../entry/src/main/ets/service/realtimeClient.ets', () => ({ realtimeClient: { environment: () => undefined, turnClaim: mock.turnClaim } }));
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
const timeout = () => Object.assign(new Error('request timed out'), { code: 2300028 });
const httpError = (status: number) => Object.assign(new XopcHttpError(status), { status });

describe('local-first session creation', () => {
  it('recovers a lost acceptance without submitting the first input again', async () => {
    mock.read.mockResolvedValue(draft());
    mock.request.mockRejectedValueOnce(timeout()).mockResolvedValueOnce(response('message-1'));
    await expect(new XopcChatRepository().send('draft-1', 'hello', 'message-1')).resolves.toBe('run-1');
    expect(mock.request.mock.calls.map(call => call[1] ?? 'GET')).toEqual(['POST', 'GET']);
    expect(mock.request.mock.calls[1][0]).toBe('/api/sessions/draft-1/input-receipts/message-1');
    expect(mock.clearCommand).toHaveBeenCalledOnce();
  });

  it('recovers an existing-session append without creating a new conversation or message', async () => {
    mock.request.mockResolvedValueOnce(JSON.stringify({ payload: { configVersion: 3 } }))
      .mockRejectedValueOnce(timeout()).mockResolvedValueOnce(response('message-1'));
    await expect(new XopcChatRepository().send('draft-1', 'hello', 'message-1', 'transcript-1')).resolves.toBe('run-1');
    expect(JSON.parse(mock.request.mock.calls[1][2])).toMatchObject({
      kind: 'append', clientMessageId: 'message-1', expectedTranscriptId: 'transcript-1', configVersion: 3,
    });
    expect(mock.request.mock.calls.filter(call => call[1] === 'POST')).toHaveLength(1);
    expect(mock.remove).not.toHaveBeenCalled();
  });

  it('does not accept a mismatched receipt as successful delivery', async () => {
    mock.read.mockResolvedValue(draft());
    mock.request.mockRejectedValueOnce(timeout()).mockResolvedValueOnce(response('other-message'));
    await expect(new XopcChatRepository().send('draft-1', 'hello', 'message-1')).rejects.toThrow('INVALID_INPUT_RESPONSE');
    expect(mock.clearCommand).not.toHaveBeenCalled();
  });

  it('replays the same command only after a missing receipt, preserving attachments and references', async () => {
    mock.read.mockResolvedValue(draft());
    mock.request.mockRejectedValueOnce(timeout()).mockRejectedValueOnce(httpError(404)).mockResolvedValueOnce(response('message-1'));
    const attachment = { type: 'image', name: 'photo.png', mimeType: 'image/png', size: 1, data: 'YQ==' };
    await expect(new XopcChatRepository().send('draft-1', 'hello', 'message-1', '', [attachment], 'next',
      [{ kind: 'note', sourceId: 'note-1' }])).resolves.toBe('run-1');
    expect(mock.request.mock.calls[2]).toEqual(mock.request.mock.calls[0]);
    expect(mock.uuid).not.toHaveBeenCalled();
  });

  it('keeps the original command after bounded retries are exhausted', async () => {
    mock.read.mockResolvedValue(draft());
    mock.request.mockRejectedValueOnce(timeout()).mockRejectedValueOnce(httpError(404))
      .mockRejectedValueOnce(timeout()).mockRejectedValueOnce(httpError(404));
    await expect(new XopcChatRepository().send('draft-1', 'hello', 'message-1')).rejects.toThrow('request timed out');
    expect(mock.request).toHaveBeenCalledTimes(4);
    expect(mock.clearCommand).not.toHaveBeenCalled();
    expect(await mock.readCommand()).toMatchObject({ clientMessageId: 'message-1' });
  });

  it('also checks acceptance after the compensating POST loses its response', async () => {
    mock.read.mockResolvedValue(draft());
    mock.request.mockRejectedValueOnce(httpError(503)).mockRejectedValueOnce(httpError(404))
      .mockRejectedValueOnce(timeout()).mockResolvedValueOnce(response('message-1'));
    await expect(new XopcChatRepository().send('draft-1', 'hello', 'message-1')).resolves.toBe('run-1');
    expect(mock.request).toHaveBeenCalledTimes(4);
  });

  it.each([401, 403, 409, 410, 429])('does not replay a non-transient HTTP %s rejection', async status => {
    mock.read.mockResolvedValue(draft());
    mock.request.mockRejectedValue(httpError(status));
    await expect(new XopcChatRepository().send('draft-1', 'hello', 'message-1')).rejects.toThrow();
    expect(mock.request).toHaveBeenCalledOnce();
  });

  it('does not replay when receipt lookup itself is unavailable', async () => {
    mock.read.mockResolvedValue(draft());
    mock.request.mockRejectedValue(timeout());
    await expect(new XopcChatRepository().send('draft-1', 'hello', 'message-1')).rejects.toThrow();
    expect(mock.request).toHaveBeenCalledTimes(2);
    expect(mock.clearCommand).not.toHaveBeenCalled();
  });

  it('stops compensation when the gateway identity changes', async () => {
    mock.read.mockResolvedValue(draft());
    mock.request.mockImplementationOnce(async () => {
      mock.assertConnection.mockImplementation(() => { throw new Error('OPERATION_CANCELLED'); });
      throw timeout();
    });
    await expect(new XopcChatRepository().send('draft-1', 'hello', 'message-1')).rejects.toThrow('OPERATION_CANCELLED');
    expect(mock.request).toHaveBeenCalledOnce();
  });
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

  it('inherits the project agent and execution environment before the first send', async () => {
    mock.request.mockResolvedValue(JSON.stringify({ project: { id: 'project-1', name: 'Project', status: 'active',
      defaultAgentId: 'coder', workspaceRoot: '/workspace', executionMode: 'managed_worktree' } }));
    const id = await new XopcChatRepository().create('project-1');
    expect(id).toBe('draft-1');
    expect(mock.request).toHaveBeenCalledWith('/api/projects/project-1');
    expect(mock.save).toHaveBeenCalledWith(expect.objectContaining({ creation: {
      agentId: 'coder', projectId: 'project-1', execution: { mode: 'managed_worktree' }, temporary: false,
      model: '', thinkingLevel: 'off',
    } }), 'gateway:device');
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

  it('normalizes rich queued updates to the Gateway wire contract', async () => {
    mock.request.mockResolvedValue(JSON.stringify({ payload: { conversationId: 'session-1', inputs: [] } }));
    const queued = { id: 'input-1', clientMessageId: 'message-1', content: 'old', version: 7, position: 0,
      kind: 'message', status: 'queued', requestedDelivery: 'next', effectiveDelivery: 'next' };
    await new XopcChatRepository().updateQueued('session-1', queued, {
      content: '', attachments: [{ type: 'voice', name: 'voice.m4a', mimeType: 'audio/mp4', size: 2, data: 'YQ==', duration: 3 }],
      contextRefs: [{ kind: 'note', sourceId: 'note-1', expectedVersion: '4', title: 'Note' }],
    });
    expect(mock.request).toHaveBeenCalledWith('/api/sessions/session-1/inputs/input-1', 'PATCH', expect.any(String));
    expect(JSON.parse(mock.request.mock.calls[0][2])).toEqual({
      version: 7, content: '', attachments: [{ type: 'voice', name: 'voice.m4a', mimeType: 'audio/mp4', size: 2,
        data: 'YQ==', durationSeconds: 3 }], contextRefs: [{ kind: 'note', sourceId: 'note-1', expectedVersion: '4' }],
    });
  });

  it('replaces the latest turn with a claimed rich input', async () => {
    mock.uuid.mockReturnValue('replacement-message');
    mock.request.mockResolvedValueOnce(JSON.stringify({ payload: { configVersion: 5 } }))
      .mockResolvedValueOnce(JSON.stringify({ payload: { state: { activeRunId: 'replacement-run' } } }));
    const runId = await new XopcChatRepository().replaceLatest('session-1', 'turn/1', 'revised', [{
      type: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', size: 3, data: 'YQ=='
    }], [{ kind: 'task', sourceId: 'task-1', expectedVersion: '8', title: 'Task' }]);
    expect(runId).toBe('replacement-run');
    expect(mock.request.mock.calls[1][0]).toBe('/api/sessions/session-1/turns/turn%2F1/replace');
    expect(JSON.parse(mock.request.mock.calls[1][2])).toMatchObject({
      clientMessageId: 'replacement-message', configVersion: 5, content: 'revised', delivery: 'next',
      origin: { type: 'endpoint', endpointId: 'phone', token: 'claim' },
      attachments: [{ type: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', size: 3, data: 'YQ==' }],
      contextRefs: [{ kind: 'task', sourceId: 'task-1', expectedVersion: '8' }],
    });
  });

  it('opens and sends to the task conversation with the task input wire format', async () => {
    const repository = new XopcChatRepository();
    mock.request.mockResolvedValueOnce(JSON.stringify({ ok: true, conversationId: 'task-chat', created: false }));
    await expect(repository.ensureTaskConversation('task/1')).resolves.toBe('task-chat');
    expect(mock.request.mock.calls[0][0]).toBe('/api/tasks/task%2F1/conversation');
    mock.request.mockResolvedValueOnce(JSON.stringify({ payload: { configVersion: 4 } }))
      .mockResolvedValueOnce(JSON.stringify({ ok: true, payload: {
        conversationId: 'task-chat', state: { activeRunId: 'task-run' }
      } }));
    await expect(repository.send('task-chat', 'continue task', 'message-1', 'transcript-1', [], 'next', [], 'task/1'))
      .resolves.toBe('task-run');
    expect(mock.request.mock.calls[2][0]).toBe('/api/tasks/task%2F1/inputs');
    expect(JSON.parse(mock.request.mock.calls[2][2])).toMatchObject({
      clientMessageId: 'message-1', expectedTranscriptId: 'transcript-1', configVersion: 4,
      content: 'continue task', delivery: 'next', origin: { type: 'endpoint', endpointId: 'phone', token: 'claim' }
    });
    expect(JSON.parse(mock.request.mock.calls[2][2])).not.toHaveProperty('kind');
  });
});
