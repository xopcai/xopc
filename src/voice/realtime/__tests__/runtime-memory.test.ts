import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { VOICE_REALTIME_PROTOCOL_VERSION, parseVoiceServerEvent, type VoiceServerEvent } from '@xopcai/realtime-protocol/voice';

import { ConfigSchema } from '../../../config/schema.js';
import { notifyUserContextChange, onUserContextChange } from '../../../user-context/changes.js';
import { VoiceRealtimeRuntime } from '../runtime.js';
import type { VoiceConversationContext } from '../conversation-context.js';

vi.mock('../../../gateway/security/device-request-proof.js', () => ({ verifyDeviceConnectionProof: () => true }));

const engine = vi.hoisted(() => ({ start: vi.fn(async () => {}), close: vi.fn(async () => {}), appendAudio: vi.fn(), setInputMuted: vi.fn(), cancel: vi.fn(), acknowledge: vi.fn(), commit: vi.fn(), updateContext: vi.fn(() => true), restoreTasks: vi.fn() }));
const create = vi.hoisted(() => vi.fn());
vi.mock('../omniEngine.js', () => ({ createOmniVoiceEngine: (options: unknown) => { create(options); return engine; } }));

describe('native voice memory lifecycle', () => {
  let runtime: VoiceRealtimeRuntime;
  let server: Server;
  let socket: WebSocket;
  let events: VoiceServerEvent[];
  const conversationId = 'agent:main:webchat:default:direct:test';
  afterEach(async () => {
    socket?.terminate();
    if (runtime) await vi.waitFor(() => expect(runtime.hasConversation(conversationId)).toBe(false));
    runtime?.close();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.clearAllMocks();
  });
  async function start(context: VoiceConversationContext, ready = true) {
    events = [];
    const config = ConfigSchema.parse({ voice: { realtime: { enabled: true, defaultEngine: 'omni', omni: { provider: 'alibaba', apiKey: 'test', model: 'qwen3-omni-flash-realtime', voice: 'Cherry', instructions: '' } } } });
    runtime = new VoiceRealtimeRuntime({ getConfig: () => config, sessionExists: async () => true,
      sessionBusy: () => false, getSessionIdentity: async () => 'stored', getConversationContext: async () => ({ ...context }),
      recordOmniTranscript: async () => {}, recordInterruption: async () => {},
      agentBroker: { delegate: vi.fn(), cancel: vi.fn(async () => true) } });
    server = createServer(); server.on('upgrade', (request, client, head) => runtime.handleUpgrade(request, client as Socket, head));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    await dial(ready);
  }
  async function dial(ready = true) {
    events = [];
    const session = await runtime.createSession({ purpose: 'conversation', mode: 'natural', conversationId,
      supportedProtocolVersions: [3], mediaPreferences: ['websocket-pcm'] }, 'owner');
    socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}${session.websocketPath}`);
    socket.on('message', (data) => events.push(parseVoiceServerEvent(JSON.parse(data.toString()))));
    await once(socket, 'open');
    socket.send(JSON.stringify({ protocolVersion: VOICE_REALTIME_PROTOCOL_VERSION, messageId: crypto.randomUUID(), sentAt: Date.now(), type: 'session.start', payload: { sessionId: session.sessionId, ticket: session.ticket } }));
    if (ready) await vi.waitFor(() => expect(events.some((e) => e.type === 'session.ready')).toBe(true));
  }
  const context = (): VoiceConversationContext => ({ identity: 'Ada', history: [], memory: {
    block: '{"backgroundMemory":{"name":"Mic"}}', references: [], isCurrent: () => true,
    subscribe: (invalidate) => onUserContextChange(() => invalidate()),
  } });

  it('reloads private history on redial independently of the visible shared Chat snapshot', async () => {
    const value: VoiceConversationContext = { identity: 'Ada', history: [], sharedChat: '' };
    await start(value);
    expect(create.mock.calls[0][0].restoreHistory()).toBe('');
    value.history.push({ role: 'user', content: '周四去杭州，预算三千，不要订票。', timestamp: Date.now() });
    socket.close();
    await vi.waitFor(() => expect(runtime.hasConversation(conversationId)).toBe(false));
    await dial();
    const options = create.mock.calls[1][0];
    expect(options.restoreHistory()).toContain('周四去杭州');
    expect(options.route.instructions).not.toContain('周四去杭州');
    expect(value.sharedChat).toBe('');
    expect(events.some(event => JSON.stringify(event).includes('周四去杭州'))).toBe(false);
  });

  it('synchronizes a new shared Chat snapshot once and restores tasks after the client is ready', async () => {
    const value = { ...context(), sharedChat: 'previous snapshot' };
    await start(value);
    expect(engine.restoreTasks).toHaveBeenCalledOnce();
    value.sharedChat = '{"recentTurns":[{"role":"user","text":"Keep the draft private"}]}';
    runtime.refreshConversation(conversationId);
    await vi.waitFor(() => expect(engine.updateContext).toHaveBeenCalledOnce());
    expect(engine.updateContext).toHaveBeenCalledWith(create.mock.calls[0][0].route.instructions, value.sharedChat);
    runtime.refreshConversation(conversationId);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(engine.updateContext).toHaveBeenCalledOnce();
    expect(engine.close).not.toHaveBeenCalled();
  });

  it('injects memory only upstream and ends the connection when its source changes', async () => {
    await start(context());
    expect(create.mock.calls[0][0].route.instructions).toContain('Mic');
    expect(JSON.stringify(events)).not.toContain('Mic');
    const closed = once(socket, 'close');
    notifyUserContextChange({ kind: 'policy' });
    await closed;
    expect(engine.close).toHaveBeenCalledOnce();
    expect(events).toContainEqual(expect.objectContaining({ type: 'session.error', payload: expect.objectContaining({ code: 'CONTEXT_CHANGED' }) }));
    expect(runtime.hasConversation(conversationId)).toBe(false);
    notifyUserContextChange({ kind: 'policy' }); await Promise.resolve();
    expect(engine.close).toHaveBeenCalledOnce();
  });

  it('retains a newer Chat change arriving during an in-flight refresh', async () => {
    const value = { ...context(), sharedChat: 'before' };
    await start(value);
    engine.updateContext.mockImplementationOnce(() => {
      value.sharedChat = 'latest';
      runtime.refreshConversation(conversationId);
      return true;
    });
    value.sharedChat = 'first';
    runtime.refreshConversation(conversationId);
    await vi.waitFor(() => expect(engine.updateContext).toHaveBeenCalledTimes(2));
    expect(engine.updateContext).toHaveBeenLastCalledWith(expect.any(String), 'latest');
  });

  it('rejects a stale snapshot before opening an upstream connection', async () => {
    const value = context(); value.memory!.isCurrent = () => false;
    await start(value, false);
    await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.CLOSED));
    expect(create).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'session.ready')).toBe(false);
  });

  it('keeps history-only calls working and closes them on a real Chat reset', async () => {
    await start({ identity: 'Ada', history: [] });
    notifyUserContextChange({ kind: 'policy' }); await Promise.resolve();
    expect(engine.close).not.toHaveBeenCalled();
    const closed = once(socket, 'close');
    notifyUserContextChange({ kind: 'session-reset', id: conversationId }); await closed;
    expect(engine.close).toHaveBeenCalledOnce();
  });

  it('ends a history-only call when its agent persona snapshot changes', async () => {
    let current = true;
    await start({ identity: 'Ada', history: [], isCurrent: () => current });
    const closed = once(socket, 'close');
    current = false;
    await closed;
    expect(engine.close).toHaveBeenCalledOnce();
    expect(events).toContainEqual(expect.objectContaining({
      type: 'session.error',
      payload: expect.objectContaining({ code: 'CONTEXT_CHANGED' }),
    }));
  });
});
