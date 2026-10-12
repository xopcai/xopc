import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import { VOICE_REALTIME_PROTOCOL_VERSION, decodeVoiceAudioFrame, createVoiceSessionResponseSchema, parseVoiceServerEvent, type VoiceClientMessage, type VoiceServerEvent } from '@xopcai/realtime-protocol/voice';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import * as personalRepository from '../../../personal-agent/repository.js';
import { closeXopcDatabase, requireXopcDatabase } from '../../../storage/sqlite/connection.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { ConfigSchema } from '../../../config/schema.js';
import type { StreamingSttEvent } from '../../../media-understanding/types.js';
import { alibabaTranscriptionProvider } from '../../stt/providers/alibaba-transcription.js';
import { VoiceRealtimeRuntime } from '../runtime.js';
import { speakStream } from '../../tts/speak-core.js';

vi.mock('../../../gateway/security/device-request-proof.js', () => ({ verifyDeviceConnectionProof: () => true }));

vi.mock('../../tts/speak-core.js', () => ({
  prepareSpeechStreamSession: vi.fn(),
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
  let fixtureDirectory: string | undefined;
  let previousStateDirectory: string | undefined;
  let abortStt: ReturnType<typeof vi.fn>;

  afterEach(async () => {
    socket?.terminate();
    runtime?.close();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.restoreAllMocks();
    if (fixtureDirectory) {
      closeXopcDatabase();
      if (previousStateDirectory === undefined) delete process.env.XOPC_STATE_DIR;
      else process.env.XOPC_STATE_DIR = previousStateDirectory;
      rmSync(fixtureDirectory, { recursive: true, force: true }); fixtureDirectory = undefined;
    }
  });

  function send(type: VoiceClientMessage['type'], payload: VoiceClientMessage['payload']) {
    socket.send(JSON.stringify({ protocolVersion: VOICE_REALTIME_PROTOCOL_VERSION, messageId: crypto.randomUUID(), sentAt: Date.now(), type, payload }));
  }

  async function start(bargeIn = true, recordInterruption = async () => {}, initialUserTurn = true, greeting?: { logicalCallId: string; initiation: 'user' | 'recovery' }, waitReady = true) {
    if (greeting) {
      previousStateDirectory = process.env.XOPC_STATE_DIR;
      fixtureDirectory = mkdtempSync(join(tmpdir(), 'xopc-runtime-opening-'));
      process.env.XOPC_STATE_DIR = fixtureDirectory;
      requireXopcDatabase();
      vi.spyOn(personalRepository, 'getPersonalAgentByConversation').mockReturnValue({
        state: 'ready', userCallName: '小明', voiceCallPreferences: { openingGreetingEnabled: true },
      } as never);
    }
    abortStt = vi.fn();
    events = [];
    frames = [];
    vi.spyOn(alibabaTranscriptionProvider, 'openAudioStream').mockImplementation(async (request) => {
      onSttEvent = request.onEvent;
      request.signal.addEventListener('abort', () => request.onEvent({ type: 'error', error: new Error('Voice request aborted') }), { once: true });
      return { appendAudio: vi.fn(), abort: abortStt, commit: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    });
    const config = ConfigSchema.parse({
      voice: { realtime: { enabled: true, bargeIn } },
      tools: { media: { audio: { enabled: true, provider: 'alibaba', providers: { alibaba: { apiKey: 'test-stt' } } } } },
      messages: { tts: { enabled: true, provider: 'alibaba', providers: { alibaba: { apiKey: 'test-tts', voice: 'Cherry' } } } },
    });
    const delegate = vi.fn(async () => ({ taskId: 'voice-task', runId: 'voice-run',
      events: (async function* () { yield { type: 'assistant_delta', payload: { delta: 'Hello.' } }; })() }));
    runtime = new VoiceRealtimeRuntime({
      getConfig: () => config,
      getSessionIdentity: async () => 'durable-session',
      sessionExists: async () => true,
      sessionBusy: () => false,
      agentBroker: {
        delegate,
        cancel: async () => true,
      },
      recordInterruption,
    });
    server = createServer();
    server.on('upgrade', (request, client, head) => runtime.handleUpgrade(request, client as Socket, head));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const session = createVoiceSessionResponseSchema.parse(await runtime.createSession({
      purpose: 'conversation', mode: 'assistant', conversationId: 'agent:main:webchat:default:direct:voice',
      ...(greeting ? { openingGreeting: { ...greeting, supportsOutputReady: true as const } } : {}),
      supportedProtocolVersions: [3], mediaPreferences: ['websocket-pcm'],
    }, 'user-1'));
    expect(session.bargeIn).toBe(bargeIn);
    socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}${session.websocketPath}`);
    socket.on('message', (data, binary) => {
      if (binary) frames.push(decodeVoiceAudioFrame(data as Buffer).audio.byteLength);
      else events.push(parseVoiceServerEvent(JSON.parse(data.toString())));
    });
    await once(socket, 'open');
    send('session.start', { sessionId: session.sessionId, ticket: session.ticket });
    if (waitReady) await vi.waitFor(() => expect(events.some((event) => event.type === 'session.ready')).toBe(true));
    if (!initialUserTurn) return { delegate, session };
    onSttEvent({ type: 'transcript_final', utteranceId: 'u1', revision: 1, text: 'Hi' });
    await vi.waitFor(() => expect(frames.reduce((sum, bytes) => sum + bytes, 0)).toBe(96_000));
    const created = events.find((event) => event.type === 'response.created');
    if (created?.type !== 'response.created') throw new Error('Response was not created');
    responseId = created.payload.responseId;
    return { delegate, session };
  }

  it('prepares a cold greeting before connection readiness and plays immediately after output readiness', async () => {
    let releaseSynthesis!: () => void;
    const synthesisGate = new Promise<void>(resolve => { releaseSynthesis = resolve; });
    let synthesisStarted = false;
    const synthesize = vi.mocked(speakStream).getMockImplementation()!;
    vi.mocked(speakStream).mockImplementationOnce(async (...args) => {
      synthesisStarted = true;
      await synthesisGate;
      return synthesize(...args);
    });
    const { session } = await start(true, async () => {}, false,
      { logicalCallId: crypto.randomUUID(), initiation: 'user' }, false);
    await vi.waitFor(() => expect(synthesisStarted).toBe(true));
    await new Promise(resolve => setTimeout(resolve, 2_100));
    expect(events.some(event => event.type === 'session.ready')).toBe(false);
    expect(frames).toHaveLength(0);
    expect(events.some(event => event.type === 'response.cancelled')).toBe(false);
    releaseSynthesis();
    await vi.waitFor(() => expect(events.some(event => event.type === 'session.ready')).toBe(true));
    send('session.output_ready', { connectionEpoch: session.connectionEpoch });
    await vi.waitFor(() => expect(frames.reduce((sum, bytes) => sum + bytes, 0)).toBe(96_000));
    const responseId = session.openingGreeting!.greetingResponseId!;
    send('response.audio.played', { responseId, playedDurationMs: 2_000 });
    await vi.waitFor(() => expect(frames.reduce((sum, bytes) => sum + bytes, 0)).toBe(192_000));
    send('response.audio.played', { responseId, playedDurationMs: 4_000 });
    await vi.waitFor(() => expect(events.some(event => event.type === 'response.done')).toBe(true));
  });

  it('waits for output readiness and ignores repeated readiness after a named greeting', async () => {
    const { delegate, session } = await start(true, async () => {}, false,
      { logicalCallId: crypto.randomUUID(), initiation: 'user' });
    expect(session.openingGreeting?.accepted).toBe(true);
    expect(events.some(event => event.type === 'response.created')).toBe(false);
    send('session.output_ready', { connectionEpoch: session.connectionEpoch });
    send('session.output_ready', { connectionEpoch: session.connectionEpoch });
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
    expect(events).toContainEqual(expect.objectContaining({ type: 'response.text.delta', payload: {
      responseId: session.openingGreeting!.greetingResponseId, delta: '嗨，小明，我在。',
    } }));
    expect(delegate).not.toHaveBeenCalled();
    send('response.stop_playback', { responseId: session.openingGreeting!.greetingResponseId! });
    await vi.waitFor(() => expect(events.some(event => event.type === 'response.cancelled')).toBe(true));
    expect(events.filter(event => event.type === 'response.created')).toHaveLength(1);
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS count FROM voice_opening_greetings').get()?.count).toBe(1);
  });

  it('does not greet a recovering call even when it has not played an opening', async () => {
    const { session, delegate } = await start(true, async () => {}, false,
      { logicalCallId: crypto.randomUUID(), initiation: 'recovery' });
    expect(session.openingGreeting).toEqual({ accepted: false });
    send('session.output_ready', { connectionEpoch: session.connectionEpoch });
    send('session.ping', {});
    await vi.waitFor(() => expect(events.some(event => event.type === 'session.pong')).toBe(true));
    expect(events.some(event => event.type === 'response.created')).toBe(false);
    expect(delegate).not.toHaveBeenCalled();
  });

  it('skips an opening when speech starts before the output handshake', async () => {
    const { session } = await start(true, async () => {}, false,
      { logicalCallId: crypto.randomUUID(), initiation: 'user' });
    onSttEvent({ type: 'speech_started', utteranceId: 'early' });
    send('session.output_ready', { connectionEpoch: session.connectionEpoch });
    await vi.waitFor(() => expect(getSqliteDatabase().prepare('SELECT state FROM voice_opening_greetings').get()?.state).toBe('skipped'));
    expect(events.some(event => event.type === 'response.created')).toBe(false);
  });

  it('delivers a background Task update through the live assistant call', async () => {
    const { delegate } = await start(true, async () => {}, false);
    const conversationId = 'agent:main:webchat:default:direct:voice';
    expect(runtime.canOfferTaskUpdate(conversationId)).toBe(true);
    const delivery = runtime.offerTaskUpdate({ conversationId, clientMessageId: 'task-main-update:entry-1',
      content: 'Summarize the worker result' });
    await vi.waitFor(() => expect(frames.reduce((sum, bytes) => sum + bytes, 0)).toBe(96_000));
    const created = events.find((event) => event.type === 'response.created');
    if (created?.type !== 'response.created') throw new Error('Task update response was not created');
    responseId = created.payload.responseId;
    expect(delegate).toHaveBeenCalledWith(expect.objectContaining({
      clientMessageId: 'task-main-update:entry-1', origin: { type: 'system', source: 'task_update' },
    }));
    expect(runtime.canOfferTaskUpdate(conversationId)).toBe(false);
    send('response.audio.played', { responseId, playedDurationMs: 2_000 });
    await vi.waitFor(() => expect(frames.reduce((sum, bytes) => sum + bytes, 0)).toBe(192_000));
    send('response.audio.played', { responseId, playedDurationMs: 4_000 });
    await expect(delivery).resolves.toBe(true);
    expect(events.some((event) => event.type === 'session.error')).toBe(false);
    expect(runtime.canOfferTaskUpdate(conversationId)).toBe(true);
  });

  async function roundTrip() {
    const pongs = events.filter((event) => event.type === 'session.pong').length;
    send('session.ping', {});
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'session.pong')).toHaveLength(pongs + 1));
  }

  it('streams a persisted personal reply over the live call without another Agent run', async () => {
    const { delegate } = await start(true, async () => {}, false);
    const reply = { conversationId: 'agent:main:webchat:default:direct:voice', deliveryId: 'reply:result-1', text: 'Your result is ready.' };
    const delivery = runtime.offerReply(reply);
    await vi.waitFor(() => expect(frames.reduce((sum, bytes) => sum + bytes, 0)).toBe(96_000));
    const created = events.find(event => event.type === 'response.created');
    if (created?.type !== 'response.created') throw new Error('Personal reply was not created');
    const id = created.payload.responseId;
    expect(delegate).not.toHaveBeenCalled();
    send('response.audio.played', { responseId: id, playedDurationMs: 2_000 });
    await vi.waitFor(() => expect(frames.reduce((sum, bytes) => sum + bytes, 0)).toBe(192_000));
    send('response.audio.played', { responseId: id, playedDurationMs: 4_000 });
    expect(await delivery).toBe(true);
    await roundTrip();
    expect(await runtime.offerReply(reply)).toBe(true);
    expect(events.filter(event => event.type === 'response.created')).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'response.text.delta', payload: { responseId: id, delta: reply.text } }));
  });

  it('bounds fast output and resumes without loss as playback is acknowledged', async () => {
    await start();
    await roundTrip();
    expect(frames.every((bytes) => bytes === 960)).toBe(true);
    expect(events.some((event) => event.type === 'response.cancelled' || event.type === 'response.done')).toBe(false);
    send('response.audio.played', { responseId, playedDurationMs: 2_000 });
    await vi.waitFor(() => expect(frames.reduce((sum, bytes) => sum + bytes, 0)).toBe(192_000));
    expect(events.some((event) => event.type === 'response.done')).toBe(false);
    send('response.audio.played', { responseId, playedDurationMs: 4_000 });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'response.done')).toBe(true));
    expect(frames.reduce((sum, bytes) => sum + bytes, 0)).toBe(192_000);
    expect(events.some((event) => event.type === 'session.error' || event.type === 'response.cancelled')).toBe(false);
  });

  it.each([true, false])('honors bargeIn=%s after speech is finalized during playback', async (bargeIn) => {
    await start(bargeIn);
    onSttEvent({ type: 'speech_started', utteranceId: 'u2' });
    await roundTrip();
    expect(events.some((event) => event.type === 'response.cancelled')).toBe(false);
    onSttEvent({ type: 'transcript_delta', utteranceId: 'u2', revision: 1, text: 'Stop' });
    await roundTrip();
    expect(events.some((event) => event.type === 'response.cancelled')).toBe(false);
    onSttEvent({ type: 'speech_stopped', utteranceId: 'u2' });
    onSttEvent({ type: 'transcript_final', utteranceId: 'u2', revision: 2, text: 'Stop' });
    await roundTrip();
    expect(events.some((event) => event.type === 'response.cancelled')).toBe(bargeIn);
    if (!bargeIn) {
      send('response.stop_playback', { responseId });
      await vi.waitFor(() => expect(events.some((event) => event.type === 'response.cancelled')).toBe(true));
    }
    send('response.audio.played', { responseId, playedDurationMs: 2_000 });
    await roundTrip();
    expect(frames.reduce((sum, bytes) => sum + bytes, 0)).toBe(96_000);
    expect(events.some((event) => event.type === 'response.done' || event.type === 'session.error')).toBe(false);
  });

  it('holds the session reservation until pending interruption metadata is saved', async () => {
    let finish!: () => void;
    const saved = new Promise<void>((resolve) => { finish = resolve; });
    const record = vi.fn(async () => { await saved; });
    await start(true, record);
    send('response.stop_playback', { responseId });
    await vi.waitFor(() => expect(record).toHaveBeenCalledOnce());
    send('session.stop', { reason: 'user_finished' });
    await vi.waitFor(() => expect(abortStt).toHaveBeenCalled());
    expect(runtime.hasConversation('agent:main:webchat:default:direct:voice')).toBe(true);
    const closed = once(socket, 'close');
    finish();
    await closed;
    expect(events.some((event) => event.type === 'session.error')).toBe(false);
    expect(runtime.hasConversation('agent:main:webchat:default:direct:voice')).toBe(false);
    await expect(runtime.createSession({ purpose: 'conversation', mode: 'assistant', conversationId: 'agent:main:webchat:default:direct:voice', supportedProtocolVersions: [3], mediaPreferences: ['websocket-pcm'] }, 'user-1')).resolves.toHaveProperty('ticket');
  });

  it('waits for an already closing session before acknowledging cancellation for reconnect', async () => {
    let finish!: () => void;
    const saved = new Promise<void>((resolve) => { finish = resolve; });
    const record = vi.fn(async () => { await saved; });
    const { session } = await start(true, record);
    send('response.stop_playback', { responseId });
    await vi.waitFor(() => expect(record).toHaveBeenCalledOnce());
    send('session.stop', { reason: 'user_finished' });
    await vi.waitFor(() => expect(abortStt).toHaveBeenCalled());
    let cancelled = false;
    const cancellation = runtime.cancelSession(session.sessionId, session.ticket, 'user-1')
      .then((result) => { cancelled = true; return result; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(cancelled).toBe(false);
    const closed = once(socket, 'close');
    finish();
    await expect(cancellation).resolves.toBe(true);
    await closed;
    await expect(runtime.createSession({ purpose: 'conversation', mode: 'assistant',
      conversationId: 'agent:main:webchat:default:direct:voice', supportedProtocolVersions: [3],
      mediaPreferences: ['websocket-pcm'] }, 'user-1')).resolves.toHaveProperty('ticket');
  });

  it('rejects acknowledgements for audio that was never sent', async () => {
    await start();
    const closed = once(socket, 'close');
    send('response.audio.played', { responseId, playedDurationMs: 4_000 });
    expect((await closed)[0]).toBe(4400);
  });
});
