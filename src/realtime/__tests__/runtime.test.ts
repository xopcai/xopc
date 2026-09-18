import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket as WebSocketType } from 'ws';

import { REALTIME_CAPABILITIES, REALTIME_MAX_CLIENT_FRAME_BYTES, REALTIME_PROTOCOL_VERSION, parseServerRealtimeMessage } from '@xopcai/realtime-protocol';
import { RealtimeRuntime } from '../runtime.js';
import { COMPUTER_DESCRIPTOR } from '@xopcai/computer-control-contract';
import { endpointHelloSigningPayload, type EndpointHelloPayload } from '@xopcai/endpoint-tools-protocol';
import { generateKeyPairSync, sign } from 'node:crypto';
import { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';

const { WebSocket } = createRequire(import.meta.url)('ws') as typeof import('ws');

function waitForOpen(socket: WebSocketType): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function collectMessages(socket: WebSocketType) {
  const queued: ReturnType<typeof parseServerRealtimeMessage>[] = [];
  const waiters: Array<(message: ReturnType<typeof parseServerRealtimeMessage>) => void> = [];
  socket.on('message', (data) => {
    const message = parseServerRealtimeMessage(JSON.parse(data.toString()));
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queued.push(message);
  });
  return {
    next: () => {
      const message = queued.shift();
      return message
        ? Promise.resolve(message)
        : new Promise<ReturnType<typeof parseServerRealtimeMessage>>((resolve) => waiters.push(resolve));
    },
  };
}

describe('RealtimeRuntime', () => {
  let server: Server | undefined;
  let runtime: RealtimeRuntime | undefined;
  let socket: WebSocketType | undefined;

  afterEach(async () => {
    socket?.close();
    runtime?.close();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  it.each(['compatible', 'old-contract', 'bad-signature'])('handles desktop %s without confusing protocol and auth failures', async (variant) => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const principal = { id: 'desktop-test', kind: 'desktop' as const, displayName: 'Desktop', platform: 'darwin',
      publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'), createdAt: Date.now() };
    const endpoints = new EndpointToolRuntime({ auth: {
      getPrincipal: () => principal, bindEndpoint: () => true, touchPrincipal: () => {},
    } });
    runtime = new RealtimeRuntime(endpoints);
    server = createServer();
    server.on('upgrade', (request, connection, head) => {
      if (!runtime!.handleUpgrade(request, connection, head)) connection.destroy();
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test address');
    const hello: EndpointHelloPayload = {
      principalId: principal.id, endpointId: 'desktop-instance', connectionInstanceId: crypto.randomUUID(),
      displayName: principal.displayName, kind: principal.kind, platform: principal.platform, appVersion: 'test',
      availability: 'foreground', nonce: crypto.randomUUID(), signedAt: Date.now(), signature: 'pending-signature',
      tools: [JSON.parse(JSON.stringify(COMPUTER_DESCRIPTOR))],
    };
    if (variant === 'old-contract') hello.tools[0]!.inputSchema = {};
    hello.signature = sign('sha256', Buffer.from(endpointHelloSigningPayload(hello)),
      { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    if (variant === 'bad-signature') hello.signature = 'x'.repeat(86);
    const issued = runtime.tickets.issue('desktop-client', 'desktop', { principalId: 'owner', scopes: ['gateway.admin'] });
    socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/realtime/v1/ws`);
    await waitForOpen(socket);
    const messages = collectMessages(socket);
    const closed = new Promise<{ code: number; reason: string }>((resolve) => socket!.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
    try {
      socket.send(JSON.stringify({ protocolVersion: REALTIME_PROTOCOL_VERSION, messageId: crypto.randomUUID(),
        kind: 'realtime.hello', sentAt: Date.now(), payload: {
          ticket: issued.ticket, clientId: 'desktop-client', clientKind: 'desktop', subscriptions: [], endpoint: hello,
        } }));
      if (variant === 'compatible') {
        await expect(messages.next()).resolves.toMatchObject({ kind: 'realtime.ready', payload: { endpoint: { endpointId: hello.endpointId } } });
      } else {
        await expect(closed).resolves.toEqual(variant === 'old-contract'
          ? { code: 4409, reason: 'GATEWAY_PROTOCOL_INCOMPATIBLE' }
          : { code: 4401, reason: 'Realtime endpoint authentication failed' });
      }
    } finally { endpoints.close(); }
  });

  it('authenticates with a one-time ticket and resumes a topic from a cursor', async () => {
    runtime = new RealtimeRuntime();
    server = createServer();
    server.on('upgrade', (request, connection, head) => {
      if (!runtime!.handleUpgrade(request, connection, head)) connection.destroy();
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');

    runtime.broker.publish('run:r1', 'run.start', {});
    const issued = runtime.tickets.issue('client-1', 'web', {
      principalId: 'owner',
      scopes: ['gateway.admin'],
    });
    socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/realtime/v1/ws`);
    await waitForOpen(socket);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      kind: 'realtime.hello',
      sentAt: Date.now(),
      payload: {
        ticket: issued.ticket,
        clientId: 'client-1',
        clientKind: 'web',
        subscriptions: [{ topic: 'run:r1', afterSeq: 0 }],
      },
    }));

    const ready = await messages.next();
    expect(ready).toMatchObject({ kind: 'realtime.ready' });
    expect(ready.payload).not.toHaveProperty('negotiatedCapabilities');
    await expect(messages.next()).resolves.toMatchObject({
      kind: 'realtime.subscribed',
      payload: { topic: 'run:r1', cursor: 0 },
    });
    await expect(messages.next()).resolves.toMatchObject({
      kind: 'realtime.event',
      payload: { topic: 'run:r1', seq: 1, event: 'run.start' },
    });

    const live = messages.next();
    runtime.broker.publish('run:r1', 'assistant.delta', { delta: 'hello' });
    await expect(live).resolves.toMatchObject({
      kind: 'realtime.event',
      payload: { seq: 2, event: 'assistant.delta', data: { delta: 'hello' } },
    });
  });

  it('negotiates only server-supported capabilities when the client opts in', async () => {
    runtime = new RealtimeRuntime();
    server = createServer();
    server.on('upgrade', (request, connection, head) => runtime!.handleUpgrade(request, connection, head));
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    const issued = runtime.tickets.issue('capable-client', 'web', { principalId: 'owner', scopes: ['gateway.admin'] });
    socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/realtime/v1/ws`);
    await waitForOpen(socket);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      kind: 'realtime.hello',
      sentAt: Date.now(),
      payload: {
        ticket: issued.ticket,
        clientId: 'capable-client',
        clientKind: 'web',
        subscriptions: [],
        capabilities: [...REALTIME_CAPABILITIES, 'future.capability'],
      },
    }));

    await expect(messages.next()).resolves.toMatchObject({
      kind: 'realtime.ready',
      payload: { negotiatedCapabilities: REALTIME_CAPABILITIES },
    });
  });

  it.each(['socket error', 'authentication exception', 'heartbeat exception'])(
    'isolates %s to its connection and accepts a new connection', async (failure) => {
      let failAuth = failure === 'authentication exception';
      const checks = vi.fn(() => {
        if (failAuth) throw new Error('database is locked');
        return true;
      });
      const intervals: Array<() => void> = [];
      const originalInterval = globalThis.setInterval;
      const intervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms: number) => {
        intervals.push(fn);
        return originalInterval(fn, ms);
      }) as typeof setInterval);
      try {
        runtime = new RealtimeRuntime(undefined, checks);
        server = createServer();
        server.on('upgrade', (request, connection, head) => runtime!.handleUpgrade(request, connection, head));
        await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing address');
        const url = `ws://127.0.0.1:${address.port}/api/realtime/v1/ws`;
        const hello = () => ({
          protocolVersion: REALTIME_PROTOCOL_VERSION, messageId: crypto.randomUUID(),
          kind: 'realtime.hello', sentAt: Date.now(), payload: {
            ticket: runtime!.tickets.issue('client', 'web', { principalId: 'owner', scopes: ['gateway.admin'] }).ticket,
            clientId: 'client', clientKind: 'web', subscriptions: [],
          },
        });
        socket = new WebSocket(url);
        await waitForOpen(socket);
        const closed = new Promise<void>((resolve) => socket!.once('close', () => resolve()));
        if (failure === 'socket error') {
          socket.send('x'.repeat(REALTIME_MAX_CLIENT_FRAME_BYTES + 1));
        } else {
          const messages = collectMessages(socket);
          socket.send(JSON.stringify(hello()));
          if (failure === 'heartbeat exception') {
            await expect(messages.next()).resolves.toMatchObject({ kind: 'realtime.ready' });
            failAuth = true;
            expect(() => intervals[0]!()).not.toThrow();
          }
        }
        await closed;
        failAuth = false;
        socket = new WebSocket(url);
        await waitForOpen(socket);
        const messages = collectMessages(socket);
        socket.send(JSON.stringify(hello()));
        await expect(messages.next()).resolves.toMatchObject({ kind: 'realtime.ready' });
      } finally {
        intervalSpy.mockRestore();
      }
    },
  );

});
