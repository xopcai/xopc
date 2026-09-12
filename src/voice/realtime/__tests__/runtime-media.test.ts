import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import { VOICE_REALTIME_PROTOCOL_VERSION, VOICE_REALTIME_PROXY_WS_PATH, encodeVoiceUplinkAudioFrame, parseVoiceServerEvent, type VoiceServerEvent } from '@xopcai/realtime-protocol/voice';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { ConfigSchema } from '../../../config/schema.js';
import { alibabaTranscriptionProvider } from '../../stt/providers/alibaba-transcription.js';
import { VoiceRealtimeRuntime } from '../runtime.js';

describe('VoiceRealtimeRuntime media frames', () => {
  let runtime: VoiceRealtimeRuntime;
  let server: Server;
  let socket: WebSocket;

  afterEach(async () => {
    socket?.terminate(); runtime?.close();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    vi.restoreAllMocks();
  });

  async function start(websocketPath?: string) {
    const appendAudio = vi.fn();
    vi.spyOn(alibabaTranscriptionProvider, 'openAudioStream').mockImplementation(async () => ({ appendAudio, abort: vi.fn(), commit: vi.fn(async () => {}) }));
    const config = ConfigSchema.parse({ voice: { realtime: { enabled: true } }, tools: { media: { audio: {
      enabled: true, provider: 'alibaba', providers: { alibaba: { apiKey: 'test' } },
    } } } });
    runtime = new VoiceRealtimeRuntime({ getConfig: () => config, sessionExists: async () => true, sessionBusy: () => false,
      agentBroker: { delegate: vi.fn(), cancel: vi.fn(async () => true) }, recordInterruption: async () => {} });
    server = createServer();
    server.on('upgrade', (request, client, head) => runtime.handleUpgrade(request, client as Socket, head));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const session = await runtime.createSession({ purpose: 'dictation', supportedProtocolVersions: [3], mediaPreferences: ['websocket-pcm'] }, 'owner');
    const events: VoiceServerEvent[] = [];
    socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}${websocketPath ?? session.websocketPath}`);
    socket.on('message', (data, binary) => { if (!binary) events.push(parseVoiceServerEvent(JSON.parse(data.toString()))); });
    await once(socket, 'open');
    socket.send(JSON.stringify({ protocolVersion: VOICE_REALTIME_PROTOCOL_VERSION, messageId: crypto.randomUUID(), sentAt: Date.now(),
      type: 'session.start', payload: { sessionId: session.sessionId, ticket: session.ticket } }));
    await vi.waitFor(() => expect(events.some(value => value.type === 'session.ready')).toBe(true));
    return { appendAudio, events, session };
  }

  it('accepts ordered 20 ms uplink frames and ignores exact replays', async () => {
    const { appendAudio, session } = await start();
    const bytes = encodeVoiceUplinkAudioFrame({ connectionEpoch: session.connectionEpoch, utteranceId: 'utterance', audioSeq: 1,
      capturedAtMonotonicMs: 10, durationMs: 20, start: true, audio: new Uint8Array(640) });
    socket.send(bytes); socket.send(bytes);
    await vi.waitFor(() => expect(appendAudio).toHaveBeenCalledOnce());
    expect(appendAudio).toHaveBeenCalledWith(new Uint8Array(640));
  });

  it('accepts voice sessions through the shared reverse-proxy WebSocket route', async () => {
    const { events } = await start(VOICE_REALTIME_PROXY_WS_PATH);
    expect(events).toContainEqual(expect.objectContaining({ type: 'session.ready' }));
  });

  it('closes a stream with a sequence gap', async () => {
    const { events, session } = await start();
    socket.send(encodeVoiceUplinkAudioFrame({ connectionEpoch: session.connectionEpoch, utteranceId: 'utterance', audioSeq: 2,
      capturedAtMonotonicMs: 20, durationMs: 20, audio: new Uint8Array(640) }));
    await once(socket, 'close');
    expect(events).toContainEqual(expect.objectContaining({ type: 'session.error', payload: expect.objectContaining({ code: 'INVALID_AUDIO' }) }));
  });
});
