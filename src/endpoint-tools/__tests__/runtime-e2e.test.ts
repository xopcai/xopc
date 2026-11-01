import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ENDPOINT_PROTOCOL_VERSION,
  ENDPOINT_TEXT_OUTPUT_SCHEMA,
  endpointHelloSigningPayload,
  type ClientEndpointMessage,
  type EndpointHelloPayload,
} from '@xopcai/endpoint-tools-protocol';
import {
  REALTIME_PROTOCOL_VERSION,
  parseServerRealtimeMessage,
  type ClientRealtimeMessage,
} from '@xopcai/realtime-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket as WebSocketType } from 'ws';

import { RealtimeRuntime } from '../../realtime/runtime.js';
import { EndpointToolRuntime } from '../runtime.js';
import { openXopcDatabase, closeXopcDatabase } from '../../storage/sqlite/connection.js';
import { listEndpointToolInvocationAuditPage } from '../../storage/sqlite/endpoint-tool-invocation-repository.js';
import { executeExternalOperation } from '../../capabilities/runtime/external-operations.js';

const { WebSocket } = createRequire(import.meta.url)('ws') as typeof import('ws');

describe('endpoint tools over realtime', () => {
  const roots: string[] = [];
  afterEach(() => {
    closeXopcDatabase();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it.each([{ failCleanup: false, effect: 'read' }, { failCleanup: true, effect: 'read' },
    { failCleanup: false, effect: 'write' }, { failCleanup: true, effect: 'write' }] as const)('completes a $effect tool and isolates cleanup errors ($failCleanup)', async ({ failCleanup, effect }) => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const encodedPublicKey = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
    const root = mkdtempSync(join(tmpdir(), 'xopc-endpoint-e2e-'));
    roots.push(root);
    openXopcDatabase({ path: join(root, 'xopc.db') });
    const endpoints = new EndpointToolRuntime({
      uploadRoot: root,
      auth: {
        getPrincipal: () => ({
          id: 'principal-1', kind: 'web', displayName: 'Test browser', platform: 'web',
          publicKey: encodedPublicKey, createdAt: Date.now(),
        }),
        bindEndpoint: vi.fn(() => true),
        touchPrincipal: vi.fn(),
      },
    });
    const runtime = new RealtimeRuntime(endpoints);
    const server = createServer();
    server.on('upgrade', (request, connection, head) => {
      if (!runtime.handleUpgrade(request, connection, head)) connection.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');

    const descriptor = {
      name: effect === 'read' ? 'web.page.get_selection' : 'web.clipboard.write', title: 'Echo', description: 'Echo text.',
      inputSchema: { type: 'object' }, effect, confirmation: effect === 'read' ? 'never' as const : 'always' as const,
      outputSchema: ENDPOINT_TEXT_OUTPUT_SCHEMA,
      policyId: effect === 'read' ? 'public.foreground-read' : 'user.foreground-write', sensitivity: effect === 'read' ? 'public' as const : 'personal' as const,
      requiresForeground: true, requiredPermissions: effect === 'read' ? [] : ['clipboard-write'], timeoutMs: 10_000,
      maxConcurrency: 1, supportsCancellation: false, idempotent: true,
      resultKinds: ['text' as const],
    };
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
    const issued = runtime.tickets.issue('client-1', 'web', { principalId: 'principal-1', scopes: ['gateway.admin'] });
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/realtime/v1/ws`) as WebSocketType;
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    let readyTurnToken = '';
    let calls = 0;
    socket.on('message', (raw) => {
      const outer = parseServerRealtimeMessage(JSON.parse(raw.toString()));
      if (outer.kind === 'realtime.ready') {
        readyTurnToken = outer.payload.endpoint?.turnToken ?? '';
      } else if (outer.kind === 'endpoint.message' && outer.payload.type === 'tool.invoke') {
        calls++;
        expect(listEndpointToolInvocationAuditPage().items.find(item => item.id === outer.payload.payload.invocationId)?.status).toBe('running');
        const send = (type: ClientEndpointMessage['type'], payload: Record<string, unknown>) => {
          const endpointMessage = {
            protocolVersion: ENDPOINT_PROTOCOL_VERSION,
            messageId: crypto.randomUUID(), type, sentAt: Date.now(), payload,
          } as ClientEndpointMessage;
          const message: ClientRealtimeMessage = {
            protocolVersion: REALTIME_PROTOCOL_VERSION,
            messageId: crypto.randomUUID(), kind: 'endpoint.message', sentAt: Date.now(),
            payload: endpointMessage,
          };
          socket.send(JSON.stringify(message));
        };
        send('tool.received', { invocationId: outer.payload.payload.invocationId });
        send('tool.result', {
          invocationId: outer.payload.payload.invocationId,
          content: [{ type: 'text', text: String(outer.payload.payload.arguments.text) }],
        });
      }
    });
    socket.send(JSON.stringify({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(), kind: 'realtime.hello', sentAt: Date.now(),
      payload: {
        ticket: issued.ticket, clientId: 'client-1', clientKind: 'web', subscriptions: [],
        endpoint: { ...unsigned, signature },
      },
    } satisfies ClientRealtimeMessage));

    await vi.waitFor(() => expect(readyTurnToken).not.toBe(''));
    const endpoint = endpoints.registry.get('endpoint-1');
    expect(endpoints.registry.verifyTurnClaim('endpoint-1', readyTurnToken)).toBe(true);
    let operationId: string | undefined;
    const invoke = (id?: string) => { operationId = id; return endpoints.invocations.invoke({
      endpointId: 'endpoint-1', toolCallId: 'tool-call-1', toolName: descriptor.name,
      arguments: { text: 'round trip' }, descriptorRevision: endpoint!.tools[0]!.revision,
      ...(id ? { operationId: id } : {}),
    }); };
    const operation = { principalId: 'principal-1', capabilityId: descriptor.name, idempotencyKey: 'one-intent',
      requestDigest: 'a'.repeat(64), descriptorDigest: endpoint!.tools[0]!.revision, surface: 'fixture', recovery: 'manual' as const };
    const result = effect === 'read' ? await invoke() : await executeExternalOperation(operation, invoke);
    expect(result.content).toEqual([{ type: 'text', text: 'round trip' }]);
    if (effect === 'write') {
      expect(operationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(listEndpointToolInvocationAuditPage().items[0]).toMatchObject({ operationId, status: 'succeeded' });
      expect(await executeExternalOperation(operation, invoke)).toEqual(result); expect(calls).toBe(1);
    } else expect(listEndpointToolInvocationAuditPage().items[0]).not.toHaveProperty('operationId');

    if (failCleanup) {
      vi.spyOn(endpoints, 'remove').mockImplementation(() => { throw new Error('disconnect cleanup database failure'); });
    }
    socket.close();
    runtime.close();
    endpoints.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
