import crypto from 'node:crypto';

import { buildDevicePairingProof, type DevicePairingAction } from '@xopcai/gateway-contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BROWSER_EXTENSION_ID } from '../../../browser/extension-identity.js';
import { browserEnrollmentPublicKeyThumbprint } from '../../../browser/enrollment.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../index.js';
import { listDevices, revokeDevice, rotateDeviceRefreshToken, buildRefreshProofMessage } from '../device-access-repository.js';
import { createDevicePairingSetup, consumeDevicePairingToken } from '../device-pairing-repository.js';
import { getOrCreateGatewayIdentity } from '../gateway-identity-repository.js';
import { getSqliteDatabase } from '../transaction.js';
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

  it('automatically approves only a native-host enrollment bound to the fixed extension and device key', () => {
    const publicKeyJwk = keys.publicKey.export({ format: 'jwk' });
    const localSetup = createDevicePairingSetup([
      { id: 'local-browser', kind: 'local-browser', url: 'http://127.0.0.1:18790' },
    ], now, 3, { ttlMs: 60_000, enrollment: {
      issuer: 'browser-native-host',
      extensionId: BROWSER_EXTENSION_ID,
      publicKeyThumbprint: browserEnrollmentPublicKeyThumbprint(publicKeyJwk),
      nonce: crypto.randomBytes(24).toString('base64url'),
    } });
    base = {
      gatewayId: getOrCreateGatewayIdentity().id,
      requestId: crypto.randomUUID(),
      pairingToken: localSetup.token,
    };
    const approved = submitDevicePairingRequest(signed('request', { device: {
      displayName: 'Chrome',
      platform: 'chrome',
      extensionId: BROWSER_EXTENSION_ID,
      publicKeyJwk,
    } }), now);
    expect(approved.status).toBe('approved');

    // A retried request for the same bound device is promoted on its next status poll.
    getSqliteDatabase().prepare(
      "UPDATE device_pairing_requests SET status = 'pending', revision = revision + 1 WHERE request_id = ?",
    ).run(approved.requestId);
    expect(operateDevicePairingRequest('status', signed('status'), now).request.status).toBe('approved');

    const completed = operateDevicePairingRequest('complete', signed('complete', {
      idempotencyKey: crypto.randomUUID(),
      initialRefreshToken: refreshToken(),
    }), now);
    expect(completed.request.status).toBe('completed');
    expect(listDevices()).toHaveLength(1);
  });

  it('keeps non-local and unrecognized Chrome extensions behind explicit approval', () => {
    const remoteChrome = submitDevicePairingRequest(signed('request', { device: {
      displayName: 'Remote Chrome',
      platform: 'chrome',
      extensionId: BROWSER_EXTENSION_ID,
      publicKeyJwk: keys.publicKey.export({ format: 'jwk' }),
    } }), now);
    expect(remoteChrome.status).toBe('pending');

    const localSetup = createDevicePairingSetup([
      { id: 'local-browser', kind: 'local-browser', url: 'http://127.0.0.1:18790' },
    ], now, 3);
    base = {
      gatewayId: getOrCreateGatewayIdentity().id,
      requestId: crypto.randomUUID(),
      pairingToken: localSetup.token,
    };
    const otherExtension = submitDevicePairingRequest(signed('request', { device: {
      displayName: 'Other extension',
      platform: 'chrome',
      extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      publicKeyJwk: keys.publicKey.export({ format: 'jwk' }),
    } }), now);
    expect(otherExtension.status).toBe('pending');
  });

  it('does not auto-approve a leaked local token for another browser device key', () => {
    const enrolledKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const localSetup = createDevicePairingSetup([
      { id: 'local-browser', kind: 'local-browser', url: 'http://127.0.0.1:18790' },
    ], now, 3, { ttlMs: 60_000, enrollment: {
      issuer: 'browser-native-host',
      extensionId: BROWSER_EXTENSION_ID,
      publicKeyThumbprint: browserEnrollmentPublicKeyThumbprint(enrolledKeys.publicKey.export({ format: 'jwk' })),
      nonce: crypto.randomBytes(24).toString('base64url'),
    } });
    base = {
      gatewayId: getOrCreateGatewayIdentity().id,
      requestId: crypto.randomUUID(),
      pairingToken: localSetup.token,
    };
    const pending = submitDevicePairingRequest(signed('request', { device: {
      displayName: 'Different Chrome key',
      platform: 'chrome',
      extensionId: BROWSER_EXTENSION_ID,
      publicKeyJwk: keys.publicKey.export({ format: 'jwk' }),
    } }), now);
    expect(pending.status).toBe('pending');
  });
});
