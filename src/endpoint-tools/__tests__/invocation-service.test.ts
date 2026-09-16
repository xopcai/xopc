import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ENDPOINT_INVOCATION_RECEIPT_TIMEOUT_MS,
  ENDPOINT_PROTOCOL_VERSION,
  ENDPOINT_TEXT_OUTPUT_SCHEMA,
  type EndpointHelloPayload,
} from '@xopcai/endpoint-tools-protocol';

import {
  EndpointInvocationService,
  EndpointToolExecutionError,
  type EndpointInvocationServiceOptions,
} from '../invocation-service.js';
import { EndpointUploadService } from '../upload-service.js';
import {
  EndpointRegistry,
  endpointToolRevision,
  type EndpointTransport,
} from '../registry.js';

function fixture(options: EndpointInvocationServiceOptions = {}) {
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
    outputSchema: ENDPOINT_TEXT_OUTPUT_SCHEMA,
    policyId: 'user.foreground-write',
    sensitivity: 'personal' as const,
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
  return { sent, descriptor, registry, service: new EndpointInvocationService(registry, options) };
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
      protocolVersion: ENDPOINT_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      type: 'tool.received',
      sentAt: Date.now(),
      payload: { invocationId: invoke.payload.invocationId },
    });
    service.handleMessage('endpoint-1', {
      protocolVersion: ENDPOINT_PROTOCOL_VERSION,
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

  it('rejects endpoint output that violates the registered result contract', async () => {
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
      protocolVersion: ENDPOINT_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      type: 'tool.received',
      sentAt: Date.now(),
      payload: { invocationId: invoke.payload.invocationId },
    });
    service.handleMessage('endpoint-1', {
      protocolVersion: ENDPOINT_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      type: 'tool.result',
      sentAt: Date.now(),
      payload: {
        invocationId: invoke.payload.invocationId,
        content: [{ type: 'json', value: { unexpected: true } }],
      },
    });

    await expect(promise).rejects.toMatchObject<Partial<EndpointToolExecutionError>>({
      code: 'PROTOCOL_ERROR',
    });
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


describe('endpoint completion failures', () => {
  afterEach(() => vi.useRealTimers());

  it.each(['receipt timeout', 'execution timeout', 'abort', 'disconnect', 'shutdown'])(
    'settles the call without throwing on %s when audit storage fails',
    async (trigger) => {
      vi.useFakeTimers();
      const finished = vi.fn(() => { throw new Error('database is locked'); });
      const { service, descriptor, sent } = fixture({ audit: { started: vi.fn(), finished } });
      const controller = new AbortController();
      const invoke = () => service.invoke({
        endpointId: 'endpoint-1', toolCallId: 'call-1', toolName: descriptor.name,
        arguments: {}, descriptorRevision: endpointToolRevision(descriptor), signal: controller.signal,
      });
      const result = invoke().catch((error: unknown) => error);
      const invocationId = JSON.parse(sent[0]!).payload.invocationId;
      if (trigger === 'execution timeout') {
        service.handleMessage('endpoint-1', {
          protocolVersion: ENDPOINT_PROTOCOL_VERSION, messageId: crypto.randomUUID(),
          type: 'tool.received', sentAt: Date.now(), payload: { invocationId },
        });
      }
      expect(() => {
        if (trigger === 'receipt timeout') vi.advanceTimersByTime(ENDPOINT_INVOCATION_RECEIPT_TIMEOUT_MS);
        if (trigger === 'execution timeout') vi.advanceTimersByTime(descriptor.timeoutMs);
        if (trigger === 'abort') controller.abort();
        if (trigger === 'disconnect') service.failEndpoint('endpoint-1');
        if (trigger === 'shutdown') service.close();
      }).not.toThrow();
      const code = trigger.includes('timeout') ? 'TOOL_TIMEOUT'
        : trigger === 'abort' ? 'TOOL_CANCELLED' : 'ENDPOINT_DISCONNECTED';
      expect(await result).toMatchObject({ code });
      expect(finished).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      service.close();
      expect(finished).toHaveBeenCalledTimes(1);
      if (trigger !== 'abort') {
        const next = invoke().catch((error: unknown) => error);
        expect(sent.filter((value) => JSON.parse(value).type === 'tool.invoke')).toHaveLength(2);
        service.close();
        expect(await next).toMatchObject({ code: 'ENDPOINT_DISCONNECTED' });
      }
    },
  );

  it.each([false, true])('isolates upload cleanup failure (startup audit failure: %s)', async (startFails) => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-invocation-'));
    try {
      const uploads = new EndpointUploadService(root);
      vi.spyOn(uploads, 'abort').mockImplementation(() => { throw new Error('cleanup failed'); });
      const auditError = new Error('audit unavailable');
      const finished = vi.fn();
      const { service, descriptor } = fixture({ uploads, audit: {
        started: () => { if (startFails) throw auditError; }, finished,
      } });
      const result = service.invoke({
        endpointId: 'endpoint-1', toolCallId: 'call-1', toolName: descriptor.name,
        arguments: {}, descriptorRevision: endpointToolRevision(descriptor),
      }).catch((error: unknown) => error);
      expect(() => service.close()).not.toThrow();
      if (startFails) {
        expect(await result).toBe(auditError);
        expect(finished).not.toHaveBeenCalled();
      } else {
        expect(await result).toMatchObject({ code: 'ENDPOINT_DISCONNECTED' });
        expect(finished).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
      }
      expect(uploads.abort).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves a successful result when audit storage fails', async () => {
    const { service, descriptor, sent } = fixture({ audit: {
      started: vi.fn(), finished: () => { throw new Error('database is locked'); },
    } });
    const result = service.invoke({
      endpointId: 'endpoint-1', toolCallId: 'call-1', toolName: descriptor.name,
      arguments: {}, descriptorRevision: endpointToolRevision(descriptor),
    });
    const invocationId = JSON.parse(sent[0]!).payload.invocationId;
    service.handleMessage('endpoint-1', {
      protocolVersion: ENDPOINT_PROTOCOL_VERSION, messageId: crypto.randomUUID(),
      type: 'tool.received', sentAt: Date.now(), payload: { invocationId },
    });
    expect(() => service.handleMessage('endpoint-1', {
      protocolVersion: ENDPOINT_PROTOCOL_VERSION, messageId: crypto.randomUUID(),
      type: 'tool.result', sentAt: Date.now(),
      payload: { invocationId, content: [{ type: 'text', text: 'done' }] },
    })).not.toThrow();
    await expect(result).resolves.toEqual({ content: [{ type: 'text', text: 'done' }] });
  });
});
