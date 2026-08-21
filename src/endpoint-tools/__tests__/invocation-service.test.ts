import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { EndpointHelloPayload } from '@xopcai/endpoint-tools-protocol';

import {
  EndpointInvocationService,
  EndpointToolExecutionError,
} from '../invocation-service.js';
import {
  EndpointRegistry,
  endpointToolRevision,
  type EndpointTransport,
} from '../registry.js';

function fixture() {
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    send: (value: string) => sent.push(value),
    close: vi.fn(),
  } satisfies EndpointTransport;
  const descriptor = {
    name: 'web.clipboard.write',
    title: 'Write clipboard',
    description: 'Write clipboard text.',
    inputSchema: { type: 'object' },
    effect: 'write' as const,
    confirmation: 'always' as const,
    requiresForeground: true,
    requiredPermissions: ['clipboard-write'],
    timeoutMs: 10_000,
    maxConcurrency: 1,
    supportsCancellation: false,
    idempotent: true,
    resultKinds: ['text' as const],
  };
  const hello: EndpointHelloPayload = {
    principalId: 'principal-1',
    endpointId: 'endpoint-1',
    connectionInstanceId: crypto.randomUUID(),
    displayName: 'Browser tab',
    kind: 'web',
    platform: 'web',
    appVersion: '1',
    availability: 'foreground',
    nonce: 'nonce',
    signedAt: Date.now(),
    signature: 'long-enough-signature',
    tools: [descriptor],
  };
  const registry = new EndpointRegistry();
  registry.register(hello, 'connection-1', socket);
  return { sent, descriptor, registry, service: new EndpointInvocationService(registry) };
}

describe('EndpointInvocationService', () => {
  it('tracks only the current endpoint connection', () => {
    const { registry } = fixture();

    expect(registry.isCurrentConnection('endpoint-1', 'connection-1')).toBe(true);
    expect(registry.isCurrentConnection('endpoint-1', 'stale-connection')).toBe(false);
  });

  it('completes a received endpoint invocation', async () => {
    const { sent, descriptor, service } = fixture();
    const promise = service.invoke({
      endpointId: 'endpoint-1',
      toolCallId: 'tool-call-1',
      toolName: descriptor.name,
      arguments: { text: 'hello' },
      descriptorRevision: endpointToolRevision(descriptor),
    });
    const invoke = JSON.parse(sent[0]!) as { payload: { invocationId: string } };

    service.handleMessage('endpoint-1', {
      protocolVersion: 1,
      messageId: crypto.randomUUID(),
      type: 'tool.received',
      sentAt: Date.now(),
      payload: { invocationId: invoke.payload.invocationId },
    });
    service.handleMessage('endpoint-1', {
      protocolVersion: 1,
      messageId: crypto.randomUUID(),
      type: 'tool.result',
      sentAt: Date.now(),
      payload: {
        invocationId: invoke.payload.invocationId,
        content: [{ type: 'text', text: 'written' }],
      },
    });

    await expect(promise).resolves.toEqual({ content: [{ type: 'text', text: 'written' }] });
  });

  it('rejects stale descriptor revisions before sending', async () => {
    const { sent, descriptor, service } = fixture();
    const promise = service.invoke({
      endpointId: 'endpoint-1',
      toolCallId: 'tool-call-1',
      toolName: descriptor.name,
      arguments: {},
      descriptorRevision: 'stale',
    });
    await expect(promise).rejects.toMatchObject<Partial<EndpointToolExecutionError>>({
      code: 'TOOL_REVISION_MISMATCH',
    });
    expect(sent).toHaveLength(0);
  });

  it('fails pending calls when the endpoint disconnects', async () => {
    const { sent, descriptor, service } = fixture();
    const promise = service.invoke({
      endpointId: 'endpoint-1',
      toolCallId: 'tool-call-1',
      toolName: descriptor.name,
      arguments: {},
      descriptorRevision: endpointToolRevision(descriptor),
    });
    expect(sent).toHaveLength(1);
    service.failEndpoint('endpoint-1');
    await expect(promise).rejects.toMatchObject<Partial<EndpointToolExecutionError>>({
      code: 'ENDPOINT_DISCONNECTED',
    });
  });
});
