import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';

import { createOmniVoiceEngine } from '../omniEngine.js';
import type { VoiceEngine } from '../engine.js';

describe('Omni voice engine', () => {
  let server: WebSocketServer;
  let engine: VoiceEngine;
  afterEach(async () => {
    engine?.close();
    for (const socket of server?.clients ?? []) socket.terminate();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function setup() {
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
    const send = vi.fn(); const sendAudio = vi.fn(); const record = vi.fn(async () => {});
    engine = createOmniVoiceEngine({
      callId: 'test-call',
      route: { url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`, apiKey: 'test', voice: 'Cherry', instructions: 'Test', route: { provider: 'test', model: 'test', managed: false } },
      silenceDurationMs: 700, bargeIn: true, send, sendAudio, record,
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
});
