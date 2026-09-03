import { describe, expect, it } from 'vitest';

import {
  EXECUTION_HOST_PROTOCOL_VERSION,
  executionHostHelloSigningPayload,
  executionHostRegistrationSchema,
  type ExecutionHostHelloPayload,
} from './execution-host.js';

describe('execution host protocol', () => {
  it('accepts a bounded execution host registration', () => {
    expect(executionHostRegistrationSchema.parse({
      hostId: 'host-1',
      displayName: 'Build host',
      platform: 'linux',
      arch: 'x64',
      appVersion: '1.0.0',
      publicKey: 'x'.repeat(64),
      capabilities: { git: true, shell: true, search: true, patch: true },
      maxConcurrency: 4,
    }).capabilities.snapshots).toBe(false);
  });

  it('canonicalizes nested capability keys for signing', () => {
    const base = {
      protocolVersion: EXECUTION_HOST_PROTOCOL_VERSION,
      hostId: 'host-1',
      platform: 'linux',
      arch: 'x64',
      appVersion: '1',
      maxConcurrency: 1,
      nonce: 'nonce-that-is-long-enough',
      signedAt: 10,
      signature: 'pending-signature'.repeat(3),
    } as const;
    const first = { ...base, capabilities: {
      git: true, shell: true, search: true, patch: true, snapshots: false,
    } } satisfies ExecutionHostHelloPayload;
    const second = { ...base, capabilities: {
      snapshots: false, patch: true, search: true, shell: true, git: true,
    } } satisfies ExecutionHostHelloPayload;
    expect(executionHostHelloSigningPayload(first)).toBe(executionHostHelloSigningPayload(second));
  });
});
