import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';

import { createOmniVoiceEngine } from '../omniEngine.js';
import type { VoiceEngine } from '../engine.js';

describe('Omni voice engine', () => {
  let server: WebSocketServer;
  let engine: VoiceEngine;
  afterEach(async () => {
    vi.useRealTimers();
    await engine?.close();
    for (const socket of server?.clients ?? []) socket.terminate();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function setup(recordOverride?: () => Promise<void>, bargeIn = true) {
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    const received: Array<Record<string, any>> = [];
    let upstream!: WebSocket;
    server.on('connection', (socket) => {
      upstream = socket;
      socket.send(JSON.stringify({ type: 'session.created' }));
      socket.on('message', (raw) => {
        const event = JSON.parse(raw.toString()); received.push(event);
        if (event.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
      });
    });
    const send = vi.fn(); const sendAudio = vi.fn(); const record = vi.fn(recordOverride ?? (async () => {}));
    engine = createOmniVoiceEngine({
      callId: 'test-call',
      route: { url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`, apiKey: 'test', voice: 'Cherry', instructions: 'Test', route: { provider: 'test', model: 'test', managed: false } },
      silenceDurationMs: 700, bargeIn, send, sendAudio, record,
      onClose: vi.fn(async () => engine.close()),
    });
    await engine.start();
    return { received, send, sendAudio, record, emit: (event: object) => upstream.send(JSON.stringify(event)) };
  }

  it('configures native audio and sends PCM without invoking STT or Agent', async () => {
    const test = await setup();
    expect(test.received[0]?.session).toMatchObject({ voice: 'Cherry', turn_detection: { interrupt_response: true }, modalities: ['text', 'audio'] });
    engine.appendAudio(new Uint8Array([0, 1]));
    await vi.waitFor(() => expect(test.received.at(-1)).toMatchObject({ type: 'input_audio_buffer.append', audio: 'AAE=' }));
    test.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'Hello' });
    test.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'Hello' });
    await vi.waitFor(() => expect(test.record).toHaveBeenCalledOnce());
  });

  it('waits for playback and stops late audio after a tail interruption', async () => {
    const test = await setup();
    test.emit({ type: 'response.created', response: { id: 'r1' } });
    test.emit({ type: 'response.audio_transcript.delta', response_id: 'r1', delta: 'Hello' });
    test.emit({ type: 'response.audio.delta', response_id: 'r1', delta: Buffer.alloc(24000).toString('base64') });
    test.emit({ type: 'response.done', response: { id: 'r1', status: 'completed' } });
    await vi.waitFor(() => expect(test.sendAudio).toHaveBeenCalledOnce());
    expect(test.send.mock.calls.some(([type]) => type === 'response.done')).toBe(false);
    expect(engine.cancel('r1', 'client_cancelled')).toBe(true);
    test.emit({ type: 'response.audio.delta', response_id: 'r1', delta: Buffer.alloc(24000).toString('base64') });
    engine.acknowledge('r1', 24000);
    await vi.waitFor(() => expect(test.record).toHaveBeenCalledWith(expect.objectContaining({ interrupted: true, text: 'Hello' })));
    expect(test.sendAudio).toHaveBeenCalledOnce();
    expect(test.received.some((event) => event.type === 'response.cancel')).toBe(false);
  });

  it('cancels generation only once and records completed playback', async () => {
    const test = await setup();
    test.emit({ type: 'response.created', response: { id: 'r1' } });
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith('response.created', { responseId: 'r1' }));
    engine.cancel('r1', 'client_cancelled'); engine.cancel('r1', 'client_cancelled');
    await vi.waitFor(() => expect(test.received.filter((event) => event.type === 'response.cancel')).toHaveLength(1));
    test.emit({ type: 'error', error: { type: 'invalid_request_error', message: 'Conversation has none active response' } });
    test.emit({ type: 'input_audio_buffer.cleared' });
    test.emit({ type: 'input_audio_buffer.speech_started', item_id: 'fresh-r2' });
    test.emit({ type: 'response.created', response: { id: 'r2' } });
    test.emit({ type: 'response.audio_transcript.delta', response_id: 'r2', delta: 'Second' });
    test.emit({ type: 'response.audio.delta', response_id: 'r2', delta: Buffer.alloc(24000).toString('base64') });
    test.emit({ type: 'response.done', response: { id: 'r2', status: 'completed' } });
    await vi.waitFor(() => expect(test.sendAudio).toHaveBeenCalledOnce());
    engine.acknowledge('r2', 24000);
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith('response.done', { responseId: 'r2', audio: true, finishReason: 'completed' }));
    expect(test.record).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'r2', interrupted: false }));
    expect(test.send.mock.calls.some(([type]) => type === 'session.error')).toBe(false);
  });
  it('discards pre-mute input and late replies while preserving current playback', async () => {
    const test = await setup(undefined, false);
    test.emit({ type: 'response.created', response: { id: 'current' } });
    test.emit({ type: 'input_audio_buffer.speech_started', item_id: 'partial' });
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith('input.speech_started', { utteranceId: 'partial' }));
    engine.setInputMuted(true);
    await vi.waitFor(() => expect(test.received.some((event) => event.type === 'input_audio_buffer.clear')).toBe(true));
    test.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'partial', transcript: 'Do not submit' });
    test.emit({ type: 'response.created', response: { id: 'late' } });
    test.emit({ type: 'input_audio_buffer.cleared' });
    engine.setInputMuted(false);
    test.emit({ type: 'input_audio_buffer.speech_started', item_id: 'fresh' });
    test.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'fresh', transcript: 'Hello' });
    await vi.waitFor(() => expect(test.record).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'fresh' })));
    expect(test.record.mock.calls.some(([entry]) => entry.itemId === 'partial')).toBe(false);
    expect(test.send.mock.calls.some(([type, payload]) => type === 'response.created' && payload.responseId === 'late')).toBe(false);
  });

  it('waits for transcript writes before finishing close', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const test = await setup(() => pending);
    test.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'Keep this across calls' });
    await vi.waitFor(() => expect(test.record).toHaveBeenCalledOnce());
    let finished = false;
    const closing = Promise.resolve(engine.close()).then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await closing;
    expect(finished).toBe(true);
  });

  it('buffers a fast ten-second reply while waiting for actual playback', async () => {
    const test = await setup();
    test.emit({ type: 'response.created', response: { id: 'long-reply' } });
    for (let index = 0; index < 20; index++) {
      test.emit({ type: 'response.audio.delta', response_id: 'long-reply', delta: Buffer.alloc(24_000, index).toString('base64') });
    }
    test.emit({ type: 'response.done', response: { id: 'long-reply', status: 'completed' } });
    await vi.waitFor(() => expect(test.sendAudio.mock.calls.length).toBeGreaterThanOrEqual(4));
    expect(test.send.mock.calls.filter(([type]) => type === 'session.error')).toEqual([]);
    expect(test.send.mock.calls.some(([type]) => type === 'response.done')).toBe(false);
    let played = 0;
    for (let count = 4; count <= 20; count += 4) {
      await vi.waitFor(() => expect(test.sendAudio).toHaveBeenCalledTimes(count));
      played = test.sendAudio.mock.calls.reduce((sum, [, bytes]) => sum + bytes.length, 0);
      engine.acknowledge('long-reply', played);
    }
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith('response.done', expect.objectContaining({ responseId: 'long-reply' })));
    expect(played).toBe(480_000);
    expect(Buffer.concat(test.sendAudio.mock.calls.map(([, bytes]) => bytes))).toEqual(Buffer.concat(Array.from({ length: 20 }, (_, index) => Buffer.alloc(24_000, index))));
    expect(test.send.mock.calls.filter(([type]) => type === 'session.error')).toEqual([]);
  });

  it('interrupts queued speech without closing the call or playing stale audio', async () => {
    const test = await setup();
    test.emit({ type: 'response.created', response: { id: 'old' } });
    for (let index = 0; index < 20; index++) test.emit({ type: 'response.audio.delta', response_id: 'old', delta: Buffer.alloc(24_000).toString('base64') });
    await vi.waitFor(() => expect(test.sendAudio).toHaveBeenCalledTimes(4));
    expect(engine.cancel('old', 'client_cancelled')).toBe(true);
    const oldSent = test.sendAudio.mock.calls.length;
    test.emit({ type: 'response.audio.delta', response_id: 'old', delta: Buffer.alloc(24_000).toString('base64') });
    test.emit({ type: 'input_audio_buffer.cleared' });
    test.emit({ type: 'input_audio_buffer.speech_started', item_id: 'fresh-new' });
    test.emit({ type: 'response.created', response: { id: 'new' } });
    test.emit({ type: 'response.audio.delta', response_id: 'new', delta: Buffer.alloc(24_000).toString('base64') });
    test.emit({ type: 'response.done', response: { id: 'new', status: 'completed' } });
    await vi.waitFor(() => expect(test.sendAudio).toHaveBeenCalledTimes(oldSent + 1));
    expect(test.sendAudio.mock.calls.at(-1)![0]).toBe('new');
    engine.acknowledge('new', 24_000);
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith('response.done', expect.objectContaining({ responseId: 'new' })));
    expect(test.send.mock.calls.filter(([type]) => type === 'session.error')).toEqual([]);
  });

  it('bounds excessive output by stopping only the reply and accepts the next turn', async () => {
    const test = await setup();
    test.emit({ type: 'response.created', response: { id: 'excessive' } });
    for (let index = 0; index < 130; index++) test.emit({ type: 'response.audio.delta', response_id: 'excessive', delta: Buffer.alloc(24_000).toString('base64') });
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith('session.error', expect.objectContaining({ code: 'RESPONSE_FAILED', recoverable: true })));
    expect(test.send.mock.calls.filter(([type, payload]) => type === 'session.error' && !payload.recoverable)).toEqual([]);
    await vi.waitFor(() => expect(test.received.filter((event) => event.type === 'response.cancel')).toHaveLength(1));
    test.emit({ type: 'response.created', response: { id: 'next' } });
    test.emit({ type: 'response.audio_transcript.delta', response_id: 'next', delta: 'Still here.' });
    test.emit({ type: 'response.done', response: { id: 'next', status: 'completed' } });
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith('response.done', expect.objectContaining({ responseId: 'next' })));
    expect(test.record).toHaveBeenCalledWith(expect.objectContaining({ text: 'Still here.' }));
  });

  it('reports invalid provider audio with a specific error and diagnostic reference', async () => {
    const test = await setup();
    test.emit({ type: 'response.created', response: { id: 'invalid' } });
    test.emit({ type: 'response.audio.delta', response_id: 'invalid', delta: 'invalid audio content' });
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith('session.error', expect.objectContaining({ code: 'OMNI_INVALID_AUDIO', recoverable: false })));
    const message = test.send.mock.calls.find(([type]) => type === 'session.error')![1].message;
    expect(message).toContain('test-call');
    expect(message).toContain('invalid audio');
    expect(message).not.toContain('invalid audio content');
  });

  it('keeps the call connected when playback acknowledgements stall', async () => {
    const test = await setup();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    test.emit({ type: 'response.created', response: { id: 'stalled' } });
    test.emit({ type: 'response.audio.delta', response_id: 'stalled', delta: Buffer.alloc(24_000).toString('base64') });
    test.emit({ type: 'response.done', response: { id: 'stalled', status: 'completed' } });
    await vi.waitFor(() => expect(test.sendAudio).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(15_001);
    expect(test.send).toHaveBeenCalledWith('session.error', expect.objectContaining({ recoverable: true, code: 'RESPONSE_FAILED' }));
    expect(test.send.mock.calls.filter(([type, payload]) => type === 'session.error' && !payload.recoverable)).toEqual([]);
    vi.useRealTimers();
    test.emit({ type: 'response.created', response: { id: 'after-stall' } });
    test.emit({ type: 'response.done', response: { id: 'after-stall', status: 'completed' } });
    await vi.waitFor(() => expect(test.send).toHaveBeenCalledWith('response.done', expect.objectContaining({ responseId: 'after-stall' })));
  });

});
