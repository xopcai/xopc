import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  authenticateDeviceAccessToken,
  buildRefreshProofMessage,
  closeXopcDatabase,
  createDevice,
  getDevice,
  issueDeviceTokenPair,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  revokeDevice,
  rotateDeviceRefreshToken,
  type DevicePublicKeyJwk,
} from '../index.js';

describe('device access repository', () => {
  let stateDir: string;
  let privateKey: crypto.KeyObject;
  let publicKeyJwk: DevicePublicKeyJwk;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-device-access-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    privateKey = keys.privateKey;
    publicKeyJwk = keys.publicKey.export({ format: 'jwk' });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  function createTestDevice() {
    return createDevice({
      id: 'device-1',
      displayName: 'My iPhone',
      platform: 'ios',
      publicKeyJwk,
      scopes: ['gateway.status', 'sessions.read', 'device.self'],
      now: 1_000,
    });
  }

  function refresh(
    tokens: ReturnType<typeof issueDeviceTokenPair>,
    now: number,
    replay?: { requestId: string; nextRefreshToken: string; timestamp: number; nonce: string },
  ) {
    const credentialId = tokens.refreshToken.slice('xopc_rt_'.length).split('_', 1)[0];
    const timestamp = replay?.timestamp ?? now;
    const nonce = replay?.nonce ?? '0123456789abcdef';
    const requestId = replay?.requestId ?? crypto.randomUUID();
    const nextRefreshToken = replay?.nextRefreshToken
      ?? `xopc_rt_${crypto.randomUUID()}_${crypto.randomBytes(32).toString('base64url')}`;
    const message = buildRefreshProofMessage({ credentialId, timestamp, nonce, requestId, nextRefreshToken });
    const signature = crypto.sign(
      'sha256',
      Buffer.from(message),
      { key: privateKey, dsaEncoding: 'ieee-p1363' },
    ).toString('base64url');
    return rotateDeviceRefreshToken({
      refreshToken: tokens.refreshToken,
      timestamp,
      nonce,
      requestId,
      nextRefreshToken,
      signature,
      now,
    });
  }

  it('issues short-lived access and rotating refresh credentials', () => {
    createTestDevice();
    const initial = issueDeviceTokenPair('device-1', 2_000);
    expect(authenticateDeviceAccessToken(initial.accessToken, 3_000)).toMatchObject({
      deviceId: 'device-1',
      scopes: ['gateway.status', 'sessions.read', 'device.self'],
    });

    const rotated = refresh(initial, 4_000);
    expect(rotated.refreshToken).not.toBe(initial.refreshToken);
    expect(authenticateDeviceAccessToken(rotated.accessToken, 5_000)?.deviceId).toBe('device-1');
  });

  it('revokes the whole device when a rotated refresh credential is reused', () => {
    createTestDevice();
    const initial = issueDeviceTokenPair('device-1', 2_000);
    const rotated = refresh(initial, 3_000);

    expect(() => refresh(initial, 4_000)).toThrow('reuse detected');
    expect(getDevice('device-1')?.revokedAt).toBe(4_000);
    expect(authenticateDeviceAccessToken(rotated.accessToken, 4_001)).toBeUndefined();
  });

  it('replays the same rotation request without revoking the device', () => {
    createTestDevice();
    const initial = issueDeviceTokenPair('device-1', 2_000);
    const request = {
      requestId: crypto.randomUUID(),
      nextRefreshToken: `xopc_rt_${crypto.randomUUID()}_${crypto.randomBytes(32).toString('base64url')}`,
      timestamp: 3_000,
      nonce: '0123456789abcdef',
    };
    const first = refresh(initial, 3_000, request);
    const replay = refresh(initial, 3_100, request);
    expect(replay.refreshToken).toBe(first.refreshToken);
    expect(getDevice('device-1')?.revokedAt).toBeUndefined();
  });

  it('revokes access and refresh credentials together', () => {
    createTestDevice();
    const tokens = issueDeviceTokenPair('device-1', 2_000);
    expect(revokeDevice('device-1', 3_000)).toBe(true);
    expect(authenticateDeviceAccessToken(tokens.accessToken, 3_001)).toBeUndefined();
    expect(() => refresh(tokens, 3_002)).toThrow('Device is unavailable');
  });
});
