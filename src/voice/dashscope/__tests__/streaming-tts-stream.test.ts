import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';

import { openDashScopeStreamingTts } from '../streaming-tts-stream.js';

describe('DashScope TTS cancellation', () => {
  let server: WebSocketServer;
  afterEach(async () => {
    for (const socket of server?.clients ?? []) socket.terminate();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
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
