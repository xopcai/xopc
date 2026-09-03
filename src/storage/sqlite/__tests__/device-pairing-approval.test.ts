import crypto from 'node:crypto';

import { buildDevicePairingProof, type DevicePairingAction } from '@xopcai/gateway-contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../index.js';
import { listDevices, revokeDevice, rotateDeviceRefreshToken, buildRefreshProofMessage } from '../device-access-repository.js';
import { createDevicePairingSetup, consumeDevicePairingToken } from '../device-pairing-repository.js';
import { getOrCreateGatewayIdentity } from '../gateway-identity-repository.js';
import { cancelDevicePairingSetup, decideDevicePairingRequest, operateDevicePairingRequest, submitDevicePairingRequest } from '../device-pairing-approval.js';

describe('computer-approved device pairing', () => {
  const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const routes = [{ id: 'route', kind: 'custom-https' as const, url: 'https://example.com' }];
  const now = 1_000_000;
  let base: Record<string, unknown>;
  beforeEach(() => {
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' });
    const setup = createDevicePairingSetup(routes, now, 3);
    base = { gatewayId: getOrCreateGatewayIdentity().id, requestId: crypto.randomUUID(), pairingToken: setup.token };
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });
  function signed(action: DevicePairingAction, extra: Record<string, unknown> = {}, at = now) {
    const body = { ...base, ...extra, timestamp: at, nonce: crypto.randomBytes(24).toString('base64url') };
    return { ...body, signature: crypto.sign('sha256', Buffer.from(buildDevicePairingProof(action, body)),
      { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
  }
  function request() {
    return submitDevicePairingRequest(signed('request', { device: {
      displayName: 'Work phone', platform: 'ios', publicKeyJwk: keys.publicKey.export({ format: 'jwk' }),
    } }), now);
  }
  const refreshToken = () => `xopc_rt_${crypto.randomUUID()}_${crypto.randomBytes(32).toString('base64url')}`;

  it('requires approval, refuses v2 exchange, and recovers a lost completion response without creating another device', () => {
    const pending = request();
    expect(request()).toEqual(pending);
    expect(listDevices()).toHaveLength(0);
    expect(consumeDevicePairingToken(String(base.pairingToken), now).ok).toBe(false);
    const initialRefreshToken = refreshToken();
    const complete = signed('complete', { idempotencyKey: crypto.randomUUID(), initialRefreshToken });
    expect(() => operateDevicePairingRequest('complete', complete, now)).toThrow('PAIRING_NOT_APPROVED');
    decideDevicePairingRequest(pending.requestId, 'approve', pending.revision, now);
    const result = operateDevicePairingRequest('complete', complete, now);
    expect(result.request.status).toBe('completed');
    expect(operateDevicePairingRequest('complete', complete, now)).toEqual(result);
    expect(listDevices()).toHaveLength(1);
    expect(listDevices()[0].scopes).not.toContain('gateway.admin');
    const nextRefreshToken = refreshToken();
    const refresh = { refreshToken: initialRefreshToken, nextRefreshToken, requestId: crypto.randomUUID(), timestamp: now,
      nonce: crypto.randomBytes(24).toString('base64url') };
    const message = buildRefreshProofMessage({ ...refresh, credentialId: initialRefreshToken.slice(8).split('_')[0] });
    const signature = crypto.sign('sha256', Buffer.from(message), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    expect(rotateDeviceRefreshToken({ ...refresh, signature, now }).refreshToken).toBe(nextRefreshToken);
    revokeDevice(result.request.deviceId!, now);
    expect(() => operateDevicePairingRequest('complete', complete, now)).toThrow('DEVICE_REVOKED');
  });

  it('does not let another phone replace the pending request or modify a signed request', () => {
    request();
    expect(() => submitDevicePairingRequest(signed('request', { requestId: crypto.randomUUID(), device: {
      displayName: 'Other phone', platform: 'ios', publicKeyJwk: keys.publicKey.export({ format: 'jwk' }),
    } }), now)).toThrow('PAIRING_BUSY');
    const proof = signed('status');
    expect(() => operateDevicePairingRequest('cancel', proof, now)).toThrow('PAIRING_DENIED');
    expect(() => operateDevicePairingRequest('status', { ...proof, gatewayId: crypto.randomUUID() }, now)).toThrow('PAIRING_IDENTITY_MISMATCH');
  });

  it('cancellation and expiry prevent approval and completion', () => {
    const pending = request();
    cancelDevicePairingSetup(pending.setupId, now);
    expect(() => decideDevicePairingRequest(pending.requestId, 'approve', pending.revision, now)).toThrow('PAIRING_CHANGED');
    expect(operateDevicePairingRequest('status', signed('status'), now).request.status).toBe('cancelled');
  });

  it('expires pending approval even when the QR is still valid', () => {
    const pending = request();
    const at = pending.expiresAt + 1;
    expect(operateDevicePairingRequest('status', signed('status', {}, at), at).request.status).toBe('expired');
    expect(listDevices()).toHaveLength(0);
  });
});
