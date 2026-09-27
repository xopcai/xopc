import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayFetch, outbox } = vi.hoisted(() => ({
  gatewayFetch: vi.fn(),
  outbox: new Map<string, unknown>(),
}));

vi.mock('./auth', () => ({
  gatewayFetch,
  getAccessProfile: vi.fn().mockResolvedValue({ gatewayUrl: 'http://localhost:8080' }),
  readProfile: vi.fn().mockResolvedValue({ gatewayId: 'gateway', deviceId: 'device' }),
}));

vi.mock('@xopcai/realtime-client', () => ({
  RealtimeClient: class {},
}));

vi.mock('./chat-outbox', () => ({
  readBrowserOutbox: vi.fn(async (conversationId: string) => outbox.get(conversationId)),
  writeBrowserOutbox: vi.fn(async (conversationId: string, value: unknown) => { outbox.set(conversationId, value); }),
  deleteBrowserOutbox: vi.fn(async (conversationId: string) => { outbox.delete(conversationId); }),
}));

import { BrowserChatClient, type BrowserChatSnapshot } from './chat-client';
import { readProfile } from './auth';

type ClientInternals = {
  profileIdentity?: { gatewayId: string; deviceId: string; gatewayPublicKey?: string };
  snapshot: BrowserChatSnapshot;
  turnClaim?: { endpointId: string; token: string };
  runTopic?: string;
  reloadMessages(): Promise<void>;
  loadModels(): Promise<void>;
  onRealtimeEvent(topic: string, seq: number, event: string, data: unknown): Promise<void>;
  update(patch: Partial<BrowserChatSnapshot>): void;
};

function internals(client: BrowserChatClient): ClientInternals {
  return client as unknown as ClientInternals;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function acceptedInput(_path: unknown, init: RequestInit): Promise<Response> {
  const command = JSON.parse(String(init.body));
  return Promise.resolve(response({ payload: {
    receipt: { conversationId: 'chat:one', clientMessageId: command.clientMessageId, transcriptId: 'transcript' },
    session: { transcriptId: 'transcript' }, inputState: { inputs: [] },
    agentConfig: { model: 'test/one', thinkingLevel: 'off', fixedModel: true, activityDetail: 'on', configVersion: 1 },
  } }));
}

function stubChrome() {
  const session = new Map<string, unknown>();
  const messages: Record<string, string> = {
    errorWaitQueuedMessage: 'Wait for the queued message to be delivered before sending another',
    errorSentStatusUnknown: 'Message sent, but the response status could not be refreshed. Reopen this chat to sync it.',
  };
  vi.stubGlobal('chrome', {
    i18n: { getMessage: (key: string) => messages[key] ?? key },
    storage: {
      session: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.flatMap((key) => session.has(key) ? [[key, session.get(key)]] : []));
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.entries(values).forEach(([key, value]) => session.set(key, value));
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => session.delete(key));
        }),
      },
      local: { get: vi.fn(), set: vi.fn() },
    },
  });
  return session;
}

function readyClient(): BrowserChatClient {
  const client = new BrowserChatClient();
  internals(client).profileIdentity = { gatewayId: 'gateway', deviceId: 'device' };
  internals(client).update({ conversationId: 'chat:one', transcriptId: 'transcript', endpointReady: true,
    modelConfig: { model: 'test/one', thinkingLevel: 'off', activityDetail: 'on', fixedModel: true, configVersion: 1 } });
  internals(client).turnClaim = { endpointId: 'browser:one', token: 'turn-token' };
  return client;
}

beforeEach(() => {
  vi.mocked(readProfile).mockResolvedValue({ gatewayId: 'gateway', deviceId: 'device' } as Awaited<ReturnType<typeof readProfile>>);
  gatewayFetch.mockReset();
  outbox.clear();
  stubChrome();
});

afterEach(() => vi.unstubAllGlobals());

describe('BrowserChatClient delivery safety', () => {
  it.each([['test/configured', 'test/configured'], [undefined, '']])('creates locally using only the configured default %s', async (defaultId, expected) => {
    const client = readyClient();
    gatewayFetch.mockResolvedValue(response({ payload: { defaultId, models: [
      { id: 'test/first', name: 'First' },
      { id: 'test/configured', name: 'Configured', thinking: { mode: 'levels', initialValue: 'high' } },
    ] } }));
    await internals(client).loadModels();
    gatewayFetch.mockClear();
    vi.spyOn(client, 'openSession').mockResolvedValue(undefined);
    await client.createSession();
    expect(gatewayFetch).not.toHaveBeenCalled();
    expect([...outbox.values()]).toEqual([expect.objectContaining({ model: expected,
      thinkingLevel: defaultId ? 'high' : 'off' })]);
  });

  it('does not submit the previous conversation under a newly selected profile', async () => {
    const client = readyClient();
    vi.mocked(readProfile).mockResolvedValue({ gatewayId: 'other', deviceId: 'device' } as Awaited<ReturnType<typeof readProfile>>);
    await expect(client.send('old conversation text')).rejects.toThrow('errorChatChanged');
    expect(gatewayFetch).not.toHaveBeenCalled();
    expect(outbox.size).toBe(0);
  });
  it('retains the original outbox and ignores a receipt after profile switching', async () => {
    const client = readyClient();
    const creation = { agentId: 'main', projectId: null, execution: null, temporary: false,
      model: 'test/one', thinkingLevel: 'off' };
    outbox.set('creation:gateway:device:chat:one', creation);
    gatewayFetch.mockImplementation(async (path, init) => {
      vi.mocked(readProfile).mockResolvedValue({ gatewayId: 'other', deviceId: 'device' } as Awaited<ReturnType<typeof readProfile>>);
      return acceptedInput(path, init);
    });
    await expect(client.send('private draft')).resolves.toBe('queued');
    expect(outbox.get('creation:gateway:device:chat:one')).toEqual(creation);
    expect(outbox.has('input:creation:gateway:device:chat:one')).toBe(true);
    expect([...outbox.keys()].some(key => key.includes('other'))).toBe(false);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expect(gatewayFetch.mock.calls[0]?.[2]).toMatchObject({ gatewayId: 'gateway', deviceId: 'device' });
  });

  it('switches a session that already has a fixed model selection', async () => {
    const client = readyClient();
    internals(client).update({
      models: [
        { id: 'test/first', name: 'First' },
        { id: 'test/second', name: 'Second', thinking: { mode: 'levels', options: ['low'], initialValue: 'low' } },
      ],
      modelConfig: {
        model: 'test/first',
        thinkingLevel: 'high',
        activityDetail: 'on',
        configVersion: 7,
        fixedModel: true,
      },
    });
    gatewayFetch.mockResolvedValueOnce(response({
      payload: {
        model: 'test/second',
        thinkingLevel: 'low',
        configVersion: 8,
        fixedModel: true,
      },
    }));

    await client.updateModel('test/second');

    expect(gatewayFetch).toHaveBeenCalledWith('/api/sessions/chat%3Aone/agent-config', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ model: 'test/second', thinkingLevel: 'low', configVersion: 7 }),
    }));
    expect(internals(client).snapshot.modelConfig).toEqual({
      model: 'test/second',
      thinkingLevel: 'low',
      activityDetail: 'on',
      configVersion: 8,
      fixedModel: true,
    });
  });

  it('keeps an uncertain delivery queued and blocks a second message', async () => {
    const client = readyClient();
    gatewayFetch
      .mockResolvedValueOnce(response({}))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(client.send('hello')).resolves.toBe('queued');

    expect(internals(client).snapshot).toMatchObject({ submitting: false, pendingDelivery: true });
    expect(internals(client).snapshot.messages.at(-1)).toMatchObject({
      role: 'user',
      blocks: [{ type: 'text', text: 'hello' }],
    });
    expect(outbox.has('input:creation:gateway:device:chat:one')).toBe(true);
    await expect(client.send('send twice')).rejects.toThrow('queued message');
    expect(gatewayFetch).toHaveBeenCalledTimes(2);
    expect(gatewayFetch).toHaveBeenNthCalledWith(1, '/api/endpoint-tools/bindings/chat%3Aone', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ endpointId: 'browser:one' }),
    }));
    expect(gatewayFetch).toHaveBeenNthCalledWith(2, '/api/sessions/chat%3Aone/inputs', expect.objectContaining({ method: 'POST' }), expect.objectContaining({ gatewayId: 'gateway', deviceId: 'device' }));
  });

  it('rolls back an optimistic message when the Gateway rejects it', async () => {
    const client = readyClient();
    gatewayFetch
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ error: { message: 'Invalid input' } }, 400));

    await expect(client.send('invalid')).rejects.toThrow('Invalid input');

    expect(internals(client).snapshot).toMatchObject({ submitting: false, pendingDelivery: false, messages: [] });
    expect(outbox.has('input:creation:gateway:device:chat:one')).toBe(false);
    expect(gatewayFetch).toHaveBeenNthCalledWith(2, '/api/sessions/chat%3Aone/inputs', expect.objectContaining({ method: 'POST' }), expect.objectContaining({ gatewayId: 'gateway', deviceId: 'device' }));
  });

  it('does not queue a message again after the Gateway accepted it', async () => {
    const client = readyClient();
    gatewayFetch
      .mockResolvedValueOnce(response({}))
      .mockImplementationOnce(acceptedInput)
      .mockRejectedValueOnce(new TypeError('Could not refresh input state'));

    await expect(client.send('accepted')).resolves.toBe('sent');

    expect(internals(client).snapshot).toMatchObject({ submitting: false, pendingDelivery: false });
    expect(internals(client).snapshot.messages.at(-1)).toMatchObject({
      blocks: [{ type: 'text', text: 'accepted' }],
    });
    expect(internals(client).snapshot.error).toContain('Message sent');
    expect(outbox.has('input:creation:gateway:device:chat:one')).toBe(false);
    expect(gatewayFetch).toHaveBeenCalledTimes(3);
    expect(gatewayFetch).toHaveBeenNthCalledWith(2, '/api/sessions/chat%3Aone/inputs', expect.objectContaining({ method: 'POST' }), expect.objectContaining({ gatewayId: 'gateway', deviceId: 'device' }));
    expect(gatewayFetch).toHaveBeenNthCalledWith(3, '/api/sessions/chat%3Aone/input-state');
  });

  it('does not queue or submit a message when endpoint binding fails', async () => {
    const client = readyClient();
    gatewayFetch.mockRejectedValueOnce(new TypeError('Failed to bind endpoint'));

    await expect(client.send('hello')).rejects.toThrow('Failed to bind endpoint');

    expect(internals(client).snapshot).toMatchObject({ submitting: false, pendingDelivery: false, messages: [] });
    expect(outbox.has('input:creation:gateway:device:chat:one')).toBe(false);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expect(gatewayFetch).toHaveBeenCalledWith('/api/endpoint-tools/bindings/chat%3Aone', expect.objectContaining({ method: 'PUT' }));
  });

  it('does not apply a late transcript response to a different chat', async () => {
    const client = readyClient();
    let finishRequest!: (value: Response) => void;
    gatewayFetch.mockReturnValueOnce(new Promise<Response>((resolve) => { finishRequest = resolve; }));

    const loading = internals(client).reloadMessages();
    internals(client).update({ conversationId: 'chat:two', messages: [] });
    finishRequest(response({ payload: { messages: [{ role: 'assistant', content: 'old chat' }] } }));
    await loading;

    expect(internals(client).snapshot.conversationId).toBe('chat:two');
    expect(internals(client).snapshot.messages).toEqual([]);
  });

  it('restores safe attachment metadata for attachment-only messages', async () => {
    const client = readyClient();
    gatewayFetch.mockResolvedValueOnce(response({
      payload: {
        messages: [{
          id: 'message-with-file',
          role: 'user',
          content: '',
          media: [{
            type: 'photo',
            mimeType: 'image/png',
            name: 'diagram.png',
            size: 2048,
            path: '/private/path/diagram.png',
            uri: 'media://inbound/diagram.png',
            data: 'must-not-reach-ui',
          }],
        }],
      },
    }));

    await internals(client).reloadMessages();

    expect(internals(client).snapshot.messages).toEqual([{
      id: 'message-with-file',
      role: 'user',
      blocks: [],
      attachments: [{ type: 'image', mimeType: 'image/png', name: 'diagram.png', size: 2048 }],
    }]);
    expect(JSON.stringify(internals(client).snapshot.messages)).not.toContain('/private/path');
    expect(JSON.stringify(internals(client).snapshot.messages)).not.toContain('media://');
  });
});

describe('composer delivery concurrency', () => {
  it('rejects a duplicate before endpoint binding completes', async () => {
    const client = readyClient();
    let resolveBinding!: (response: Response) => void;
    gatewayFetch.mockImplementationOnce(() => new Promise(resolve => { resolveBinding = resolve; }))
      .mockImplementationOnce(acceptedInput);
    const first = client.send('one');
    await expect(client.send('two')).rejects.toThrow('Wait for the queued');
    await vi.waitFor(() => expect(resolveBinding).toBeTypeOf('function'));
    resolveBinding(response({ ok: true }));
    await first;
    expect(gatewayFetch.mock.calls.filter(([url]) => String(url).endsWith('/inputs'))).toHaveLength(1);
  });

  it('does not send into a different session after endpoint binding', async () => {
    const client = readyClient();
    let resolveBinding!: (response: Response) => void;
    gatewayFetch.mockImplementationOnce(() => new Promise(resolve => { resolveBinding = resolve; }));
    const sending = client.send('belongs to one');
    await vi.waitFor(() => expect(resolveBinding).toBeTypeOf('function'));
    internals(client).update({ conversationId: 'chat:two' });
    resolveBinding(response({ ok: true }));
    await expect(sending).rejects.toThrow('errorChatChanged');
    expect(gatewayFetch.mock.calls.some(([url]) => String(url).endsWith('/inputs'))).toBe(false);
  });

  it('edits only queued text and keeps existing attachments and contexts on the server', async () => {
    const client = readyClient();
    gatewayFetch.mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(response({ payload: { inputs: [{ id: 'input-one', version: 3, status: 'queued', content: 'edited' }] } }));
    await client.editInput('input-one', 2, 'edited');
    expect(JSON.parse(gatewayFetch.mock.calls[0][1].body as string)).toEqual({ version: 2, content: 'edited' });
    expect(internals(client).snapshot.queuedInputs?.[0].content).toBe('edited');
  });
});

describe('composer model and run state', () => {
  it('includes the selected fixed model version in the submitted input', async () => {
    const client = readyClient();
    internals(client).update({ modelConfig: { model: 'test/one', thinkingLevel: 'high', activityDetail: 'on', fixedModel: true, configVersion: 7 } });
    gatewayFetch.mockResolvedValueOnce(response({ ok: true }))
      .mockImplementationOnce(acceptedInput);
    await client.send('hello');
    const call = gatewayFetch.mock.calls.find(([url]) => String(url).endsWith('/inputs'))!;
    expect(JSON.parse(call[1].body as string).configVersion).toBe(7);
  });

  it('clears the previous stream when the next queued run starts', async () => {
    const client = readyClient();
    internals(client).update({ runId: 'old-run', streamingMessage: { id: 'old', role: 'assistant', blocks: [{ type: 'text', text: 'old response' }] } });
    internals(client).reloadMessages = vi.fn().mockResolvedValue(undefined);
    gatewayFetch.mockResolvedValueOnce(response({ payload: { activeRunId: 'new-run', inputs: [] } }));
    await client.refreshInputs();
    expect(internals(client).reloadMessages).toHaveBeenCalled();
    expect(internals(client).snapshot).toMatchObject({ runId: 'new-run', streamingMessage: { id: 'stream:new-run', blocks: [] } });
  });

  it('reduces thinking and tool events into the live assistant message', async () => {
    const client = readyClient();
    const state = internals(client);
    state.runTopic = 'run:run-one';
    state.update({ runId: 'run-one' });

    await state.onRealtimeEvent('run:run-one', 1, 'thinking_delta', {
      timestamp: 10,
      payload: { delta: 'inspect' },
    });
    await state.onRealtimeEvent('run:run-one', 2, 'tool_start', {
      timestamp: 20,
      payload: { toolCallId: 'call-1', toolName: 'read_file' },
    });
    await state.onRealtimeEvent('run:run-one', 3, 'tool_end', {
      timestamp: 30,
      payload: { toolCallId: 'call-1', toolName: 'read_file', status: 'success' },
    });
    await state.onRealtimeEvent('run:run-one', 4, 'assistant_delta', {
      timestamp: 40,
      payload: { messageId: 'answer-1', delta: 'done' },
    });

    expect(state.snapshot.streamingMessage?.blocks).toMatchObject([
      { type: 'thinking', text: 'inspect', streaming: false },
      { type: 'tool', toolCallId: 'call-1', status: 'done' },
      { type: 'text', text: 'done' },
    ]);
  });
});
