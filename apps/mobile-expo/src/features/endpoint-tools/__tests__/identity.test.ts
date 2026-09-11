import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureValues = vi.hoisted(() => new Map<string, string>());

vi.mock('expo-secure-store', () => ({
  getItem: (key: string) => secureValues.get(key) ?? null,
  setItem: (key: string, value: string) => secureValues.set(key, value),
}));

import {
  getOrCreateMobileEndpointIdentity,
  signMobileEndpointPayload,
} from '../identity';

describe('mobile endpoint identity', () => {
  beforeEach(() => secureValues.clear());

  it('binds a persisted P-256 key to the paired device principal', () => {
    const first = getOrCreateMobileEndpointIdentity('device-a');
    const second = getOrCreateMobileEndpointIdentity('device-a');
    expect(second.principalId).toBe(first.principalId);
    expect(second.publicKey).toBe(first.publicKey);

    const payload = 'signed endpoint hello';
    const key = crypto.createPublicKey({
      key: Buffer.from(first.publicKey, 'base64url'),
      format: 'der',
      type: 'spki',
    });
    expect(crypto.verify(
      'sha256',
      Buffer.from(payload),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signMobileEndpointPayload(first.privateKey, payload), 'base64url'),
    )).toBe(true);
  });

  it('uses the active gateway device id instead of persisting an unrelated principal id', () => {
    const first = getOrCreateMobileEndpointIdentity('device-a');
    const storageKey = 'xopc.endpoint-tools.mobile.identity';
    const stored = JSON.parse(secureValues.get(storageKey)!) as Record<string, unknown>;
    secureValues.set(storageKey, JSON.stringify({ ...stored, principalId: 'legacy-random-id' }));
    const second = getOrCreateMobileEndpointIdentity('device-b');

    expect(first.principalId).toBe('device-a');
    expect(second.principalId).toBe('device-b');
    expect(second.publicKey).toBe(first.publicKey);
  });
});
