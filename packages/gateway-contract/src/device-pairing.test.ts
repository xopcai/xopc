import { describe, expect, it } from 'vitest';

import { devicePairingDeviceSchema } from './device-pairing.js';

const publicKeyJwk = {
  kty: 'EC' as const,
  crv: 'P-256' as const,
  x: 'a'.repeat(43),
  y: 'b'.repeat(43),
};

describe('devicePairingDeviceSchema', () => {
  it('requires an extension id for Chrome devices', () => {
    expect(devicePairingDeviceSchema.safeParse({
      displayName: 'Chrome',
      platform: 'chrome',
      publicKeyJwk,
    }).success).toBe(false);
    expect(devicePairingDeviceSchema.safeParse({
      displayName: 'Chrome',
      platform: 'chrome',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      publicKeyJwk,
    }).success).toBe(true);
  });

  it('rejects extension identity on mobile devices', () => {
    expect(devicePairingDeviceSchema.safeParse({
      displayName: 'Phone',
      platform: 'ios',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      publicKeyJwk,
    }).success).toBe(false);
  });
});
