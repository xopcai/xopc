import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ENDPOINT_PROTOCOL_VERSION,
  endpointHelloSigningPayload,
  type ClientEndpointMessage,
  type EndpointHelloPayload,
  type ServerEndpointMessage,
} from '@xopcai/endpoint-tools-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { EndpointToolRuntime } from '../runtime.js';

describe('EndpointToolRuntime WebSocket', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('authenticates, registers, invokes, and completes an endpoint tool', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const encodedPublicKey = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
    const root = mkdtempSync(join(tmpdir(), 'xopc-endpoint-e2e-'));
    roots.push(root);
    const runtime = new EndpointToolRuntime({
      uploadRoot: root,
      auth: {
        getPrincipal: () => ({
          id: 'principal-1', kind: 'web', displayName: 'Test browser', platform: 'web',
          publicKey: encodedPublicKey, createdAt: Date.now(),
        }),
        bindEndpoint: vi.fn(() => true),
        touchPrincipal: vi.fn(),
      },
      audit: { started: vi.fn(), finished: vi.fn() },
    });
    const server = createServer();
    server.on('upgrade', (req, socket, head) => runtime.handleUpgrade(req, socket, head));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/endpoint-tools/v1/ws`);
    const descriptor = {
      name: 'web.test.echo', title: 'Echo', description: 'Echo text.',
      inputSchema: { type: 'object' }, effect: 'read' as const, confirmation: 'never' as const,
      requiresForeground: false, requiredPermissions: [], timeoutMs: 10_000,
      maxConcurrency: 1, supportsCancellation: false, idempotent: true,
      resultKinds: ['text' as const],
    };
    const ready = new Promise<Extract<ServerEndpointMessage, { type: 'endpoint.ready' }>>((resolve, reject) => {
      socket.once('error', reject);
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as ServerEndpointMessage;
        if (message.type === 'endpoint.ready') resolve(message);
        if (message.type === 'tool.invoke') {
          const send = (type: ClientEndpointMessage['type'], payload: Record<string, unknown>) => {
            socket.send(JSON.stringify({
              protocolVersion: ENDPOINT_PROTOCOL_VERSION,
              messageId: crypto.randomUUID(), type, sentAt: Date.now(), payload,
            }));
          };
          send('tool.received', { invocationId: message.payload.invocationId });
          send('tool.result', {
            invocationId: message.payload.invocationId,
            content: [{ type: 'text', text: String(message.payload.arguments.text) }],
          });
        }
      });
    });
    await new Promise<void>((resolve) => socket.once('open', resolve));
    const unsigned: EndpointHelloPayload = {
      principalId: 'principal-1', endpointId: 'endpoint-1',
      connectionInstanceId: crypto.randomUUID(), displayName: 'Test browser', kind: 'web',
      platform: 'web', appVersion: '1', availability: 'foreground', nonce: crypto.randomUUID(),
      signedAt: Date.now(), signature: 'pending', tools: [descriptor],
    };
    const signature = crypto.sign(
      'sha256', Buffer.from(endpointHelloSigningPayload(unsigned)),
      { key: privateKey, dsaEncoding: 'ieee-p1363' },
    ).toString('base64url');
    socket.send(JSON.stringify({
      protocolVersion: ENDPOINT_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(), type: 'endpoint.hello', sentAt: Date.now(),
      payload: { ...unsigned, signature },
    }));
    const readyMessage = await ready;

    const endpoint = runtime.registry.get('endpoint-1');
    expect(runtime.registry.verifyTurnClaim('endpoint-1', readyMessage.payload.turnToken)).toBe(true);
    expect(runtime.registry.verifyTurnClaim('endpoint-1', 'invalid-turn-token-that-is-long-enough')).toBe(false);
    const result = await runtime.invocations.invoke({
      endpointId: 'endpoint-1', toolCallId: 'tool-call-1', toolName: descriptor.name,
      arguments: { text: 'round trip' }, descriptorRevision: endpoint!.tools[0]!.revision,
    });
    expect(result.content).toEqual([{ type: 'text', text: 'round trip' }]);

    socket.close();
    runtime.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
