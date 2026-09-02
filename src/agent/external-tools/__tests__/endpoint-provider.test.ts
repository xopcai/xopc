import { describe, expect, it, vi } from 'vitest';

import { ENDPOINT_TEXT_OUTPUT_SCHEMA } from '@xopcai/endpoint-tools-protocol';

import type { EndpointToolRuntime } from '../../../endpoint-tools/index.js';
import { EndpointToolProvider } from '../endpoint-provider.js';

const descriptor = {
  name: 'web.clipboard.write',
  title: 'Write clipboard',
  description: 'Write text to the clipboard.',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  },
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
const endpointId = 'principal-1:tab-1';

function runtime(bound = false) {
  const tool = { descriptor, revision: 'catalog-revision' };
  const invoke = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'written' }] }));
  const endpoint = {
    endpointId,
    displayName: 'Browser tab',
    tools: [tool],
  };
  return {
    registry: {
      get: vi.fn((candidate: string) => candidate === endpointId ? endpoint : undefined),
      getTool: vi.fn((candidate: string, toolName: string) => (
        candidate === endpointId && toolName === descriptor.name ? tool : undefined
      )),
    },
    bindings: {
      get: vi.fn(() => bound ? { sessionKey: 'session-1', endpointId, boundAt: 1 } : undefined),
      resolve: vi.fn(() => bound ? endpoint : undefined),
    },
    invocations: { invoke },
  } as unknown as EndpointToolRuntime;
}

describe('EndpointToolProvider', () => {
  it('only exposes tools from the endpoint that originated the turn', async () => {
    const provider = new EndpointToolProvider({
      runtime: runtime(),
      getCurrentContext: () => ({
        channel: 'webchat',
        chatId: 'chat-1',
        sessionKey: 'session-1',
        origin: { type: 'endpoint', endpointId },
      }),
    });

    await expect(provider.search('clipboard')).resolves.toEqual([
      expect.objectContaining({
        toolRef: 'endpoint:principal-1%3Atab-1:web.clipboard.write',
        source: 'endpoint',
        namespace: endpointId,
      }),
    ]);
    await expect(provider.describe('endpoint:tab-2:web.clipboard.write')).resolves.toBeUndefined();
  });

  it('does not expose endpoint tools to channel turns', async () => {
    const provider = new EndpointToolProvider({
      runtime: runtime(),
      getCurrentContext: () => ({
        channel: 'telegram',
        chatId: 'chat-1',
        sessionKey: 'session-1',
        origin: { type: 'channel', channel: 'telegram' },
      }),
    });
    await expect(provider.search('clipboard')).resolves.toEqual([]);
  });

  it('exposes a cross-device endpoint only after the session is explicitly bound', async () => {
    const provider = new EndpointToolProvider({
      runtime: runtime(true),
      getCurrentContext: () => ({
        channel: 'telegram',
        chatId: 'chat-1',
        sessionKey: 'session-1',
        origin: { type: 'channel', channel: 'telegram' },
      }),
    });

    await expect(provider.search('clipboard')).resolves.toEqual([
      expect.objectContaining({ namespace: endpointId, title: 'Write clipboard' }),
    ]);
  });

  it('executes through the endpoint invocation state machine', async () => {
    const endpointRuntime = runtime();
    const provider = new EndpointToolProvider({
      runtime: endpointRuntime,
      getCurrentContext: () => ({
        channel: 'webchat',
        chatId: 'chat-1',
        sessionKey: 'session-1',
        origin: { type: 'endpoint', endpointId },
      }),
    });

    await expect(provider.execute(
      'endpoint:principal-1%3Atab-1:web.clipboard.write',
      { text: 'hello' },
      undefined,
      { toolCallId: 'call-1' },
    )).resolves.toMatchObject({
      content: [{ text: 'written' }],
      details: { endpointSensitivity: 'personal' },
    });
    expect(endpointRuntime.invocations.invoke).toHaveBeenCalledWith(expect.objectContaining({
      endpointId,
      toolName: descriptor.name,
      descriptorRevision: 'catalog-revision',
      arguments: { text: 'hello' },
    }));
  });
});
