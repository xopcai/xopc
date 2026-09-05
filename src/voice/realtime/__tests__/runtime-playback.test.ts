import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import { decodeVoiceAudioFrame, createVoiceSessionResponseSchema, parseVoiceServerEvent, type VoiceClientMessage, type VoiceServerEvent } from '@xopcai/realtime-protocol/voice';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { ConfigSchema } from '../../../config/schema.js';
import type { StreamingSttEvent } from '../../../media-understanding/types.js';
import { alibabaTranscriptionProvider } from '../../stt/providers/alibaba-transcription.js';
import { VoiceRealtimeRuntime } from '../runtime.js';

vi.mock('../../tts/speak-core.js', () => ({
  speakStream: vi.fn(async () => ({
    outputFormat: 'pcm',
    audioStream: new ReadableStream<Uint8Array>({
      start(controller) {
        // Four seconds arrive in one provider frame, faster than playback.
        controller.enqueue(new Uint8Array(192_000));
        controller.close();
      },
    }),
    release: async () => undefined,
  })),
}));

describe('VoiceRealtimeRuntime playback over WebSocket', () => {
  let runtime: VoiceRealtimeRuntime;
  let server: Server;
  let socket: WebSocket;
  let onSttEvent: (event: StreamingSttEvent) => void;
  let events: VoiceServerEvent[];
  let frames: number[];
  let responseId: string;

  afterEach(async () => {
    socket?.terminate();
    runtime?.close();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.restoreAllMocks();
  });

  function send(type: VoiceClientMessage['type'], payload: VoiceClientMessage['payload']) {
    socket.send(JSON.stringify({ protocolVersion: 2, messageId: crypto.randomUUID(), sentAt: Date.now(), type, payload }));
  }

  async function start(bargeIn = true) {
    events = [];
    frames = [];
    vi.spyOn(alibabaTranscriptionProvider, 'openAudioStream').mockImplementation(async (request) => {
      onSttEvent = request.onEvent;
      return { appendAudio: vi.fn(), abort: vi.fn(), commit: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    });
    const config = ConfigSchema.parse({
      voice: { realtime: { enabled: true, bargeIn } },
      tools: { media: { audio: { enabled: true, provider: 'alibaba', providers: { alibaba: { apiKey: 'test-stt' } } } } },
      messages: { tts: { enabled: true, provider: 'alibaba', providers: { alibaba: { apiKey: 'test-tts', voice: 'Cherry' } } } },
    });
    runtime = new VoiceRealtimeRuntime({
      getConfig: () => config,
      sessionExists: async () => true,
      sessionBusy: () => false,
      runAgent: async function* () { yield { type: 'assistant_delta', payload: { delta: 'Hello.' } }; },
      recordInterruption: async () => undefined,
    });
    server = createServer();
    server.on('upgrade', (request, client, head) => runtime.handleUpgrade(request, client as Socket, head));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const session = createVoiceSessionResponseSchema.parse(await runtime.createSession({
      purpose: 'conversation', engine: 'agent', sessionKey: 'agent:main:webchat:default:direct:voice',
    }, 'user-1'));
    expect(session.bargeIn).toBe(bargeIn);
    socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}${session.websocketPath}`);
    socket.on('message', (data, binary) => {
      if (binary) frames.push(decodeVoiceAudioFrame(data as Buffer).audio.byteLength);
      else events.push(parseVoiceServerEvent(JSON.parse(data.toString())));
    });
    await once(socket, 'open');
    send('session.start', { sessionId: session.sessionId, ticket: session.ticket });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'session.ready')).toBe(true));
    onSttEvent({ type: 'transcript_final', utteranceId: 'u1', revision: 1, text: 'Hi' });
    await vi.waitFor(() => expect(frames).toHaveLength(4));
    const created = events.find((event) => event.type === 'response.created');
    if (created?.type !== 'response.created') throw new Error('Response was not created');
    responseId = created.payload.responseId;
  }

  async function roundTrip() {
    const pongs = events.filter((event) => event.type === 'session.pong').length;
    send('session.ping', {});
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'session.pong')).toHaveLength(pongs + 1));
  }

  it('bounds fast output and resumes without loss as playback is acknowledged', async () => {
    await start();
    await roundTrip();
    expect(frames).toEqual([24_000, 24_000, 24_000, 24_000]);
    expect(events.some((event) => event.type === 'response.cancelled' || event.type === 'response.done')).toBe(false);
    send('response.audio.played', { responseId, playedBytes: 96_000 });
    await vi.waitFor(() => expect(frames).toHaveLength(8));
    expect(events.some((event) => event.type === 'response.done')).toBe(false);
    send('response.audio.played', { responseId, playedBytes: 192_000 });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'response.done')).toBe(true));
    expect(frames.reduce((sum, bytes) => sum + bytes, 0)).toBe(192_000);
    expect(events.some((event) => event.type === 'session.error' || event.type === 'response.cancelled')).toBe(false);
  });

  it.each([true, false])('honors bargeIn=%s while the response is waiting for playback', async (bargeIn) => {
    await start(bargeIn);
    onSttEvent({ type: 'speech_started', utteranceId: 'u2' });
    await roundTrip();
    expect(events.some((event) => event.type === 'response.cancelled')).toBe(bargeIn);
    if (!bargeIn) {
      send('response.cancel', { responseId });
      await vi.waitFor(() => expect(events.some((event) => event.type === 'response.cancelled')).toBe(true));
    }
    send('response.audio.played', { responseId, playedBytes: 96_000 });
    await roundTrip();
    expect(frames).toHaveLength(4);
    expect(events.some((event) => event.type === 'response.done' || event.type === 'session.error')).toBe(false);
  });

  it('rejects acknowledgements for audio that was never sent', async () => {
    await start();
    const closed = once(socket, 'close');
    send('response.audio.played', { responseId, playedBytes: 192_000 });
    expect((await closed)[0]).toBe(4400);
  });
});
