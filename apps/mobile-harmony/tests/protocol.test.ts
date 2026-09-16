import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildDevicePairingProof, devicePairingDeviceSchema } from '../../../packages/gateway-contract/src/device-pairing';
import { decodeBase64Url, encodeBase64Url, fixedIntegerBytes, invitationPayload, pairingProof, parseInvitationJson, secureOrigin } from '../entry/src/main/ets/common/protocol';
import type { XopcPairingBody } from '../entry/src/main/ets/model/gateway';

describe('HarmonyOS protocol conformance', () => {
  it('encodes canonical base64url matching Node, including every remainder', () => {
    for (const length of [0, 1, 2, 3, 24, 32, 64, 512]) {
      const bytes = randomBytes(length);
      expect(encodeBase64Url(bytes)).toBe(bytes.toString('base64url'));
      expect(Buffer.from(decodeBase64Url(bytes.toString('base64url')))).toEqual(bytes);
    }
    for (const invalid of ['A', 'AA=', 'AA/', 'AB', 'AA ']) expect(() => decodeBase64Url(invalid)).toThrow();
  });

  it.each(['request', 'status', 'complete', 'cancel'] as const)('matches authoritative %s proof byte-for-byte', (action) => {
    const body: XopcPairingBody = {
      gatewayId: 'gateway', requestId: 'request', pairingToken: 'token', nonce: 'nonce', timestamp: 123,
      signature: 'ignored',
      ...(action === 'request' ? { device: { displayName: '我的 "手机"\n', platform: 'harmonyos', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } } } : {}),
      ...(action === 'complete' ? { idempotencyKey: 'idempotency', initialRefreshToken: 'refresh' } : {}),
    };
    expect(pairingProof(action, body)).toBe(buildDevicePairingProof(action, { ...body }));
  });

  it('rejects unsafe route origins before any network request', () => {
    for (const invalid of ['http://host', 'https://user:password@host', 'https://host/api', 'https://host?x', 'https://host#x', 'https://host:99999', 'https://host\\@evil', 'https://host\n']) {
      expect(() => secureOrigin(invalid), invalid).toThrow();
    }
    expect(secureOrigin('https://gateway.example:443/')).toBe('https://gateway.example:443');
    expect(secureOrigin('https://[::1]:123')).toBe('https://[::1]:123');
  });

  it('accepts only valid unexpired mobile invitations', () => {
    const valid = {
      version: 3, targetKind: 'mobile', pairingToken: 'xopc_pair_12345678-1234-1234-1234-123456789012_' + 'a'.repeat(43),
      gatewayId: '12345678-1234-1234-1234-123456789012', gatewayName: 'Gateway', gatewayPublicKey: Buffer.alloc(32).toString('base64url'),
      routes: [{ id: 'https', kind: 'custom-https', url: 'https://gateway.example' }], expiresAt: 200,
    };
    expect(parseInvitationJson(JSON.stringify(valid), 100).gatewayName).toBe('Gateway');
    for (const change of [{ version: 2 }, { targetKind: 'browser' }, { expiresAt: 100 }, { gatewayId: '' }, { routes: [] }, { routes: [valid.routes[0], valid.routes[0]] }, { gatewayPublicKey: 'AB' }]) {
      expect(() => parseInvitationJson(JSON.stringify({ ...valid, ...change }), 100)).toThrow();
    }
    expect(invitationPayload('https://link.xopc.ai/connect#p=abc')).toBe('abc');
    expect(() => invitationPayload('https://evil.example/connect#p=abc')).toThrow();
  });

  it('preserves leading zeros in compact P-256 signatures', () => {
    expect(Buffer.from(fixedIntegerBytes(1n, 32)).toString('hex')).toBe('00'.repeat(31) + '01');
    expect(() => fixedIntegerBytes(-1n, 32)).toThrow();
    expect(() => fixedIntegerBytes(256n, 1)).toThrow();
  });

  it('registers HarmonyOS as a mobile device without browser identity', () => {
    const device = { displayName: 'HarmonyOS', platform: 'harmonyos', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'a'.repeat(43), y: 'b'.repeat(43) } };
    expect(devicePairingDeviceSchema.safeParse(device).success).toBe(true);
    expect(devicePairingDeviceSchema.safeParse({ ...device, extensionId: 'a'.repeat(32) }).success).toBe(false);
  });
});
