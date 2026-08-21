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

  it('persists a P-256 identity and emits valid P1363 signatures', () => {
    const first = getOrCreateMobileEndpointIdentity();
    const second = getOrCreateMobileEndpointIdentity();
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
});
