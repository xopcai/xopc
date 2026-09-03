import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  REALTIME_PROTOCOL_VERSION,
  parseServerRealtimeMessage,
  type ExecutionCommand,
} from '@xopcai/realtime-protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WebSocket as WebSocketType } from 'ws';

import {
  ExecutionHostRuntime,
  createExecutionHost,
  createExecutionHostHello,
  createExecutionHostIdentity,
} from '../../execution-hosts/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { RealtimeRuntime } from '../runtime.js';

const { WebSocket } = createRequire(import.meta.url)('ws') as typeof import('ws');

describe('RealtimeRuntime execution hosts', () => {
  let stateDir: string;
  let server: Server | undefined;
  let runtime: RealtimeRuntime | undefined;
  let socket: WebSocketType | undefined;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-realtime-host-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(async () => {
    if (socket && socket.readyState !== socket.CLOSED) {
      const closed = new Promise<void>((resolve) => socket!.once('close', () => resolve()));
      socket.close();
      await closed;
    }
    runtime?.close();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('authenticates a signed host and exchanges a fixed execution command', async () => {
    const identity = createExecutionHostIdentity({
      stateDir: join(stateDir, 'identity'),
      displayName: 'Host',
      appVersion: '1',
      capabilities: { git: true, shell: true, search: true, patch: true, snapshots: false },
      maxConcurrency: 1,
    });
    createExecutionHost(identity.registration);
    const executionHosts = new ExecutionHostRuntime();
    runtime = new RealtimeRuntime(undefined, executionHosts);
    server = createServer();
    server.on('upgrade', (request, connection, head) => {
      if (!runtime!.handleUpgrade(request, connection, head)) connection.destroy();
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');

    const issued = runtime.tickets.issue(identity.registration.hostId, 'execution_host', {
      principalId: `execution-host:${identity.registration.hostId}`,
      scopes: [],
    });
    socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/realtime/v1/ws`);
    await new Promise<void>((resolve, reject) => {
      socket!.once('open', resolve);
      socket!.once('error', reject);
    });
    const messages: Array<ReturnType<typeof parseServerRealtimeMessage>> = [];
    socket.on('message', (data) => messages.push(parseServerRealtimeMessage(JSON.parse(data.toString()))));
    socket.send(JSON.stringify({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      kind: 'realtime.hello',
      sentAt: Date.now(),
      payload: {
        ticket: issued.ticket,
        clientId: identity.registration.hostId,
        clientKind: 'execution_host',
        subscriptions: [{ topic: 'gateway' }, { topic: 'logs' }, { topic: 'sessions' }],
        executionHost: createExecutionHostHello(identity),
      },
    }));
    await expect.poll(() => messages[0]).toMatchObject({
      kind: 'realtime.ready',
      payload: { executionHost: { hostId: identity.registration.hostId } },
    });
    await expect.poll(() => messages.filter((message) => message.kind === 'realtime.error')).toHaveLength(3);
    expect(messages.filter((message) => message.kind === 'realtime.error')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ code: 'FORBIDDEN_TOPIC' }) }),
      expect.objectContaining({ payload: expect.objectContaining({ code: 'FORBIDDEN_TOPIC' }) }),
      expect.objectContaining({ payload: expect.objectContaining({ code: 'FORBIDDEN_TOPIC' }) }),
    ]);
    expect(messages.some((message) => message.kind === 'realtime.subscribed')).toBe(false);

    const command: ExecutionCommand = {
      operationId: crypto.randomUUID(),
      environmentId: 'env-1',
      bindingEpoch: 1,
      deadlineAt: Date.now() + 5_000,
      idempotencyKey: 'inspect-env-1',
      command: 'environment.inspect',
      payload: {},
    };
    const result = executionHosts.registry.execute(identity.registration.hostId, command);
    await expect.poll(() => messages.find((message) => message.kind === 'execution_host.message')).toMatchObject({
      kind: 'execution_host.message',
      payload: { type: 'execution.command', command },
    });
    socket.send(JSON.stringify({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      kind: 'execution_host.message',
      sentAt: Date.now(),
      payload: {
        type: 'execution.result',
        operationId: command.operationId,
        result: { status: 'ready' },
      },
    }));
    await expect(result).resolves.toEqual({ status: 'ready' });
  });
});
