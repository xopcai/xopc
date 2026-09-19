import { describe, expect, it } from 'vitest';

import {
  browserPairingInvitationPayloadSchema,
  devicePairingDeviceSchema,
  formatBrowserPairingInvitation,
  formatMobilePairingInvitation,
  isRetryableDevicePairingHttpStatus,
  MOBILE_PAIRING_INVITATION_VERSION,
  readBrowserPairingInvitation,
  readMobilePairingInvitation,
  type MobilePairingInvitation,
} from './device-pairing.js';

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

describe('browser pairing invitation', () => {
  it('round trips an opaque payload without creating a web URL', () => {
    const invitation = formatBrowserPairingInvitation('abc_123-XYZ');
    expect(invitation).toBe('XOPC-BROWSER-INVITE-V1:abc_123-XYZ');
    expect(readBrowserPairingInvitation(invitation)).toBe('abc_123-XYZ');
  });

  it('rejects links and malformed payloads', () => {
    expect(() => readBrowserPairingInvitation('https://link.xopc.ai/c#abc')).toThrow();
    expect(() => formatBrowserPairingInvitation('abc/123')).toThrow();
  });

  it('validates one shared payload shape', () => {
    expect(browserPairingInvitationPayloadSchema.safeParse({
      version: 3,
      targetKind: 'browser',
      pairingToken: `xopc_pair_00000000-0000-4000-8000-000000000000_${'a'.repeat(43)}`,
      gatewayId: '00000000-0000-4000-8000-000000000000',
      gatewayName: 'Workstation',
      gatewayPublicKey: 'b'.repeat(43),
      routes: [{ id: 'local-browser', kind: 'local-browser', url: 'http://127.0.0.1:18790' }],
      expiresAt: Date.now() + 60_000,
    }).success).toBe(true);
    expect(browserPairingInvitationPayloadSchema.safeParse({
      version: 3,
      targetKind: 'mobile',
      pairingToken: `xopc_pair_00000000-0000-4000-8000-000000000000_${'a'.repeat(43)}`,
      gatewayId: '00000000-0000-4000-8000-000000000000',
      gatewayName: 'Workstation',
      gatewayPublicKey: 'b'.repeat(43),
      routes: [{ id: 'route', kind: 'custom-https', url: 'http://gateway.example.com' }],
      expiresAt: Date.now() + 60_000,
    }).success).toBe(false);
  });
});

describe('mobile pairing invitation', () => {
  const invitation: MobilePairingInvitation = {
    version: MOBILE_PAIRING_INVITATION_VERSION,
    pairingToken: `xopc_pair_00000000-0000-4000-8000-000000000000_${'A'.repeat(43)}`,
    gatewayId: '11111111-1111-4111-8111-111111111111',
    gatewayPublicKey: 'A'.repeat(43),
    origins: ['https://gateway.example.com', 'https://fallback.example.com:8443'],
    expiresAt: 2_000_000_000_000,
  };

  it('round trips the compact binary Universal Link', () => {
    const link = formatMobilePairingInvitation(invitation);
    expect(link).toMatch(/^https:\/\/link\.xopc\.ai\/c#[A-Za-z0-9_-]+$/);
    expect(link.length).toBeLessThan(300);
    expect(readMobilePairingInvitation(link)).toEqual(invitation);
  });

  it('rejects the removed JSON invitation format and malformed binary payloads', () => {
    expect(() => readMobilePairingInvitation('https://link.xopc.ai/connect#p=e30')).toThrow();
    expect(() => readMobilePairingInvitation('https://link.xopc.ai/c#BA')).toThrow();
    const link = formatMobilePairingInvitation(invitation);
    expect(() => readMobilePairingInvitation(`${link}A`)).toThrow();
  });

  it('rejects duplicate or non-canonical origins', () => {
    expect(() => formatMobilePairingInvitation({ ...invitation, origins: [invitation.origins[0], invitation.origins[0]] })).toThrow();
    expect(() => formatMobilePairingInvitation({ ...invitation, origins: ['https://gateway.example.com/'] })).toThrow();
    expect(() => formatMobilePairingInvitation({ ...invitation, origins: ['http://gateway.example.com'] })).toThrow();
  });
});

describe('device pairing route retry policy', () => {
  it('retries transient route failures but not authorization failures', () => {
    expect(isRetryableDevicePairingHttpStatus(404)).toBe(true);
    expect(isRetryableDevicePairingHttpStatus(429)).toBe(true);
    expect(isRetryableDevicePairingHttpStatus(503)).toBe(true);
    expect(isRetryableDevicePairingHttpStatus(401)).toBe(false);
    expect(isRetryableDevicePairingHttpStatus(409)).toBe(false);
  });
});
