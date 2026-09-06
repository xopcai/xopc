import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';

import { openDashScopeStreamingTts } from '../streaming-tts-stream.js';

describe('DashScope streaming TTS', () => {
  let server: WebSocketServer;
  afterEach(async () => {
    for (const socket of server?.clients ?? []) socket.terminate();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function request(signal = new AbortController().signal, timeoutMs = 10_000) {
    return {
      apiKey: 'test', baseUrl: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
      model: 'test', voice: 'Cherry', text: 'Hello', timeoutMs, signal,
    };
  }

  it('retries a rejected 429 handshake and sends text only on the successful connection', async () => {
    let attempts = 0;
    const received: string[] = [];
    server = new WebSocketServer({ host: '127.0.0.1', port: 0, verifyClient: (_info, done) => {
      attempts += 1;
      if (attempts === 1) done(false, 429, 'Too Many Requests', { 'Retry-After': '1' });
      else done(true);
    } });
    await once(server, 'listening');
    server.on('connection', (socket) => {
      socket.send(JSON.stringify({ type: 'session.created' }));
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
        if (message.type === 'input_text_buffer.append') received.push(message.text);
        if (message.type === 'input_text_buffer.commit') {
          socket.send(JSON.stringify({ type: 'response.audio.delta', delta: Buffer.from([1, 2]).toString('base64') }));
          socket.send(JSON.stringify({ type: 'response.audio.done' }));
        }
      });
    });
    const startedAt = Date.now();
    const result = await openDashScopeStreamingTts(request());
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_000);
    const reader = result.audioStream.getReader();
    expect(Array.from((await reader.read()).value!)).toEqual([1, 2]);
    expect((await reader.read()).done).toBe(true);
    expect(received).toEqual(['Hello']);
    expect(attempts).toBe(2);
    await result.release?.();
  });

  it.each([
    { status: 401, retryAfter: '0', timeoutMs: 10_000, expectedAttempts: 1 },
    { status: 429, retryAfter: '0', timeoutMs: 10_000, expectedAttempts: 3 },
    { status: 429, retryAfter: '60', timeoutMs: 10_000, expectedAttempts: 1 },
    { status: 429, retryAfter: '1', timeoutMs: 500, expectedAttempts: 1 },
    { status: 429, retryAfter: new Date(Date.now() + 60_000).toUTCString(), timeoutMs: 10_000, expectedAttempts: 1 },
  ])('bounds handshake retries for $status with Retry-After=$retryAfter', async ({ status, retryAfter, timeoutMs, expectedAttempts }) => {
    let attempts = 0;
    server = new WebSocketServer({ host: '127.0.0.1', port: 0, verifyClient: (_info, done) => {
      attempts += 1;
      done(false, status, 'Rejected', { 'Retry-After': retryAfter });
    } });
    await once(server, 'listening');
    await expect(openDashScopeStreamingTts(request(undefined, timeoutMs))).rejects.toMatchObject({
      name: 'TtsHandshakeError', statusCode: status,
      message: expect.stringContaining(`HTTP ${status}`),
      retryAfterMs: expect.any(Number),
    });
    expect(attempts).toBe(expectedAttempts);
  });

  it('cancels during Retry-After without making another connection', async () => {
    let attempts = 0;
    server = new WebSocketServer({ host: '127.0.0.1', port: 0, verifyClient: (_info, done) => {
      attempts += 1;
      done(false, 429, 'Too Many Requests', { 'Retry-After': '5' });
    } });
    await once(server, 'listening');
    const controller = new AbortController();
    const opening = openDashScopeStreamingTts(request(controller.signal));
    const rejected = expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(attempts).toBe(1));
    controller.abort();
    await rejected;
    expect(attempts).toBe(1);
  });

  it('does not replay text when the provider fails after the stream is ready', async () => {
    let connections = 0;
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    server.on('connection', (socket) => {
      connections += 1;
      socket.send(JSON.stringify({ type: 'session.created' }));
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
        if (message.type === 'input_text_buffer.commit') socket.send(JSON.stringify({ type: 'error', error: { code: '429', message: 'Rate limited' } }));
      });
    });
    const result = await openDashScopeStreamingTts(request());
    await expect(result.audioStream.getReader().read()).rejects.toThrow('429: Rate limited');
    await result.release?.();
    expect(connections).toBe(1);
  });

  it.each([false, true])('aborts normally with ready=%s and does not wait for provider timeout', async (ready) => {
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    const connection = once(server, 'connection');
    server.on('connection', (socket) => {
      socket.send(JSON.stringify({ type: 'session.created' }));
      if (ready) socket.on('message', (raw) => {
        if (JSON.parse(raw.toString()).type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
      });
    });
    const controller = new AbortController();
    const opening = openDashScopeStreamingTts({
      apiKey: 'test', baseUrl: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
      model: 'test', voice: 'Cherry', text: 'Hello', timeoutMs: 10_000, signal: controller.signal,
    });
    const [socket] = await connection;
    const closed = once(socket, 'close');
    if (!ready) await once(socket, 'message');
    const stream = ready ? await opening : undefined;
    const reader = stream?.audioStream.getReader();
    const rejected = expect(reader ? reader.read() : opening).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort('client_cancelled');
    await rejected;
    expect((await closed)[0]).toBe(1000);
    await stream?.release?.();
  });
});
