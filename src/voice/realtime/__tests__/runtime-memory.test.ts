import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { parseVoiceServerEvent, type VoiceServerEvent } from '@xopcai/realtime-protocol/voice';

import { ConfigSchema } from '../../../config/schema.js';
import { notifyUserContextChange, onUserContextChange } from '../../../user-context/changes.js';
import { VoiceRealtimeRuntime } from '../runtime.js';
import type { VoiceConversationContext } from '../conversation-context.js';

const engine = vi.hoisted(() => ({ start: vi.fn(async () => {}), close: vi.fn(async () => {}), appendAudio: vi.fn(), setInputMuted: vi.fn(), cancel: vi.fn(), acknowledge: vi.fn(), commit: vi.fn() }));
const create = vi.hoisted(() => vi.fn());
vi.mock('../omniEngine.js', () => ({ createOmniVoiceEngine: (options: unknown) => { create(options); return engine; } }));

describe('native voice memory lifecycle', () => {
  let runtime: VoiceRealtimeRuntime;
  let server: Server;
  let socket: WebSocket;
  let events: VoiceServerEvent[];
  const sessionKey = 'agent:main:webchat:default:direct:test';
  afterEach(async () => {
    socket?.terminate(); runtime?.close();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.clearAllMocks();
  });
  async function start(context: VoiceConversationContext, ready = true) {
    events = [];
    const config = ConfigSchema.parse({ voice: { realtime: { enabled: true, defaultEngine: 'omni', omni: { provider: 'alibaba', apiKey: 'test', model: 'qwen3-omni-flash-realtime', voice: 'Cherry', instructions: '' } } } });
    runtime = new VoiceRealtimeRuntime({ getConfig: () => config, sessionExists: async () => true,
      sessionBusy: () => false, getSessionIdentity: async () => 'stored', getConversationContext: async () => context,
      recordOmniTranscript: async () => {}, recordInterruption: async () => {}, runAgent: vi.fn(async function* () {}) });
    server = createServer(); server.on('upgrade', (request, client, head) => runtime.handleUpgrade(request, client as Socket, head));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const session = await runtime.createSession({ purpose: 'conversation', engine: 'omni', sessionKey }, 'owner');
    socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}${session.websocketPath}`);
    socket.on('message', (data) => events.push(parseVoiceServerEvent(JSON.parse(data.toString()))));
    await once(socket, 'open');
    socket.send(JSON.stringify({ protocolVersion: 2, messageId: crypto.randomUUID(), sentAt: Date.now(), type: 'session.start', payload: { sessionId: session.sessionId, ticket: session.ticket } }));
    if (ready) await vi.waitFor(() => expect(events.some((e) => e.type === 'session.ready')).toBe(true));
  }
  const context = (): VoiceConversationContext => ({ identity: 'Ada', history: [], memory: {
    block: '{"backgroundMemory":{"name":"Mic"}}', references: [], isCurrent: () => true,
    subscribe: (invalidate) => onUserContextChange(() => invalidate()),
  } });

  it('injects memory only upstream and ends the connection when its source changes', async () => {
    await start(context());
    expect(create.mock.calls[0][0].route.instructions).toContain('Mic');
    expect(JSON.stringify(events)).not.toContain('Mic');
    const closed = once(socket, 'close');
    notifyUserContextChange({ kind: 'policy' });
    await closed;
    expect(engine.close).toHaveBeenCalledOnce();
    expect(events).toContainEqual(expect.objectContaining({ type: 'session.error', payload: expect.objectContaining({ code: 'CONTEXT_CHANGED' }) }));
    expect(runtime.hasConversation(sessionKey)).toBe(false);
    notifyUserContextChange({ kind: 'policy' }); await Promise.resolve();
    expect(engine.close).toHaveBeenCalledOnce();
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
    notifyUserContextChange({ kind: 'session-reset', id: sessionKey }); await closed;
    expect(engine.close).toHaveBeenCalledOnce();
  });
});
