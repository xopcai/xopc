import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';

import { openDashScopeStreamingStt } from '../streaming-stt-session.js';

describe('DashScope STT relay handshake', () => {
  let server: WebSocketServer;
  afterEach(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('authenticates against a relay requiring the platform Bearer scheme', async () => {
    const headers: string[] = [];
    server = new WebSocketServer({
      port: 0,
      host: '127.0.0.1',
      verifyClient: ({ req }) => {
        headers.push(req.headers.authorization ?? '');
        return req.headers.authorization === 'Bearer test-access-token';
      },
    });
    await once(server, 'listening');
    server.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        socket.send(JSON.stringify({ header: {
          event: message.header.action === 'run-task' ? 'task-started' : 'task-finished',
        } }));
      });
    });
    const session = await openDashScopeStreamingStt({
      apiKey: 'test-access-token',
      baseUrl: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/audio/transcriptions/realtime`,
      model: 'qwen-audio-3.0-asr-flash-streaming',
      inputFormat: { encoding: 'pcm_s16le', sampleRate: 16_000, channels: 1 },
      turnDetection: { mode: 'server_vad', silenceDurationMs: 600 },
      timeoutMs: 1_000,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
    });
    expect(headers).toEqual(['Bearer test-access-token']);
    await session.commit();
  });
});
