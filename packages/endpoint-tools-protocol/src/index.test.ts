import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  endpointHelloPayloadSchema,
  endpointHelloSigningPayload,
  endpointTurnClaimSchema,
  turnOriginSchema,
} from './index.js';

const hello = {
    principalId: 'browser-profile',
    endpointId: 'tab-1',
    connectionInstanceId: 'bf1a9f36-caf1-41a7-8d22-e1d6e6b4bb55',
    displayName: 'Chrome tab',
    kind: 'web' as const,
    platform: 'web',
    appVersion: '1',
    availability: 'foreground' as const,
    nonce: 'nonce-1',
    signedAt: 1,
    signature: 'signed-message-value',
    tools: [{
      name: 'web.clipboard.write',
      title: 'Write clipboard',
      description: 'Write text to the browser clipboard.',
      inputSchema: { type: 'object' },
      effect: 'write' as const,
      confirmation: 'always' as const,
      requiresForeground: true as const,
      requiredPermissions: ['clipboard-write'],
      timeoutMs: 10_000,
      maxConcurrency: 1,
      supportsCancellation: false,
      idempotent: true,
      resultKinds: ['text' as const],
    }],
};

describe('endpoint tool protocol', () => {
  it('accepts a strict endpoint identity', () => {
    expect(endpointHelloPayloadSchema.parse(hello)).toEqual(hello);
  });

  it('rejects unknown wire fields', () => {
    expect(() => endpointHelloPayloadSchema.parse({ ...hello, unexpectedField: true })).toThrow();
  });

  it('canonicalizes object keys recursively', () => {
    expect(canonicalJson({ z: 1, a: { d: 2, b: 1 } })).toBe('{"a":{"b":1,"d":2},"z":1}');
  });

  it('rejects values that JSON cannot sign without loss', () => {
    expect(() => canonicalJson({ value: undefined })).toThrow(/does not support/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });

  it('excludes the signature from the signed hello payload', () => {
    const signed = endpointHelloSigningPayload(hello);
    expect(signed).not.toContain('signed-message-value');
    expect(signed).toContain('browser-profile');
  });

  it('requires an explicit, strict turn origin', () => {
    expect(turnOriginSchema.parse({ type: 'endpoint', endpointId: 'tab-1' })).toEqual({
      type: 'endpoint',
      endpointId: 'tab-1',
    });
    expect(() => turnOriginSchema.parse({ type: 'endpoint' })).toThrow();
    expect(() => turnOriginSchema.parse({ type: 'web', endpointId: 'tab-1' })).toThrow();
  });

  it('requires an active connection token for endpoint turn claims', () => {
    expect(endpointTurnClaimSchema.parse({
      type: 'endpoint',
      endpointId: 'tab-1',
      token: 'a'.repeat(32),
    })).toEqual({ type: 'endpoint', endpointId: 'tab-1', token: 'a'.repeat(32) });
    expect(() => endpointTurnClaimSchema.parse({ type: 'endpoint', endpointId: 'tab-1' })).toThrow();
  });
});
