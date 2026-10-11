import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireXopcDatabase } from '../../../storage/sqlite/connection.js';

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

import { personalDescriptor, ENDPOINT_TEXT_OUTPUT_SCHEMA } from '@xopcai/endpoint-tools-protocol';

import { EndpointToolRuntime } from '../../../endpoint-tools/index.js';
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
    principalId: 'principal-1',
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
      get: vi.fn(() => bound ? { conversationId: 'session-1', endpointId, boundAt: 1 } : undefined),
      resolve: vi.fn(() => bound ? endpoint : undefined),
    },
    grants: { find: vi.fn(() => undefined), candidates: vi.fn(() => []) },
    invocations: { invoke },
  } as unknown as EndpointToolRuntime;
}

describe('EndpointToolProvider', () => {
  beforeEach(() => { requireXopcDatabase(); });
  it('only exposes tools from the endpoint that originated the turn', async () => {
    const provider = new EndpointToolProvider({
      runtime: runtime(),
      getCurrentContext: () => ({
        channel: 'webchat',
        chatId: 'chat-1',
        conversationId: 'session-1',
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
        conversationId: 'session-1',
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
        conversationId: 'session-1',
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
        conversationId: 'session-1',
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
  it.each(['text/plain', 'image/jpeg'])('delivers selected %s content to the model, instead of filename-only metadata', async mimeType => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-personal-provider-'));
    const native = new EndpointToolRuntime({ uploadRoot: root, audit: { started: vi.fn(), finished: vi.fn() } });
    try {
      const descriptor = personalDescriptor('mobile.file.pick');
      native.registry.register({ principalId: 'phone-owner', endpointId: 'phone', connectionInstanceId: randomUUID(),
        displayName: 'Phone', kind: 'mobile', platform: 'android', appVersion: '1', availability: 'foreground', nonce: randomUUID(), signedAt: Date.now(),
        signature: 'fixture-signature', tools: [descriptor] }, 'connection', { readyState: 1, send: () => {}, close: () => {} });
      const grant = native.uploads.createGrant('fixture', 'phone', Date.now(), 'personal', 'phone-owner');
      const bytes = mimeType === 'text/plain' ? Buffer.from('Selected document body')
        : await sharp({ create: { width: 4, height: 4, channels: 3, background: 'blue' } }).jpeg().toBuffer();
      const uploaded = await native.uploads.uploadValidated({ invocationId: 'fixture', endpointId: 'phone', token: grant.token,
        name: mimeType === 'text/plain' ? 'fixture.txt' : 'fixture.jpg', mimeType, bytes });
      const { fileId, name, size, sha256 } = uploaded;
      vi.spyOn(native.invocations, 'invoke').mockResolvedValue({ content: [{ type: 'file', fileId, name, mimeType, size, sha256 }] });
      const provider = new EndpointToolProvider({ runtime: native, getCurrentContext: () => ({ channel: 'webchat', chatId: 'chat',
        conversationId: '6d9217fe-77c7-411d-8cc9-92aabe81a2d0', origin: { type: 'endpoint', endpointId: 'phone' } }) });
      const result = await provider.execute('endpoint:phone:mobile.file.pick', {}, undefined, { toolCallId: 'read-selected' });
      if (mimeType === 'text/plain') expect(JSON.stringify(result.content)).toContain('Selected document body');
      else expect(result.content).toContainEqual(expect.objectContaining({ type: 'image', mimeType: 'image/jpeg', data: expect.any(String) }));
      expect(result.details).toMatchObject({ endpointSensitivity: 'personal', endpointFiles: [{ fileId }] });
    } finally { native.close(); rmSync(root, { recursive: true, force: true }); }
  });

});
