import crypto from 'node:crypto';

import { initialDeviceRefreshTokenSchema } from '@xopcai/gateway-contract';

import type { GatewayScope } from '../../gateway/security/gateway-scopes.js';
import { parseGatewayScopes } from '../../gateway/security/gateway-scopes.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1_000;
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
const REFRESH_PROOF_MAX_AGE_MS = 5 * 60 * 1_000;
const ACCESS_TOKEN_PREFIX = 'xopc_at_';
const REFRESH_TOKEN_PREFIX = 'xopc_rt_';

export type DevicePlatform = 'ios' | 'android';
export type DevicePublicKeyJwk = crypto.webcrypto.JsonWebKey;

export type DeviceRecord = {
  id: string;
  displayName: string;
  platform: DevicePlatform;
  publicKeyJwk: DevicePublicKeyJwk;
  scopes: GatewayScope[];
  createdAt: number;
  lastSeenAt?: number;
  revokedAt?: number;
};

export type DeviceAccessIdentity = {
  deviceId: string;
  accessSessionId: string;
  scopes: GatewayScope[];
};

export type DeviceTokenPair = {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
};

type DeviceRow = {
  device_id: string;
  display_name: string;
  platform: DevicePlatform;
  public_key_jwk: string;
  scopes_json: string;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
};

type RefreshCredentialRow = {
  credential_id: string;
  device_id: string;
  token_hash: string;
  expires_at: number;
  replaced_by: string | null;
  rotation_request_id: string | null;
  revoked_at: number | null;
};

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildToken(prefix: string, id: string): string {
  return `${prefix}${id}_${crypto.randomBytes(32).toString('base64url')}`;
}

function parseToken(token: string, prefix: string): { id: string } | undefined {
  if (!token.startsWith(prefix)) return undefined;
  const separator = token.indexOf('_', prefix.length);
  if (separator <= prefix.length || separator === token.length - 1) return undefined;
  return { id: token.slice(prefix.length, separator) };
}

function deviceFromRow(row: DeviceRow): DeviceRecord {
  return {
    id: row.device_id,
    displayName: row.display_name,
    platform: row.platform,
    publicKeyJwk: JSON.parse(row.public_key_jwk) as DevicePublicKeyJwk,
    scopes: parseGatewayScopes(row.scopes_json),
    createdAt: row.created_at,
    ...(row.last_seen_at === null ? {} : { lastSeenAt: row.last_seen_at }),
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
  };
}

export function createDevice(input: {
  id?: string;
  displayName: string;
  platform: DevicePlatform;
  publicKeyJwk: DevicePublicKeyJwk;
  scopes: readonly GatewayScope[];
  now?: number;
}): DeviceRecord {
  const id = input.id ?? crypto.randomUUID();
  const createdAt = input.now ?? Date.now();
  getSqliteDatabase().prepare(`
    INSERT INTO devices (
      device_id, display_name, platform, public_key_jwk, scopes_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.displayName,
    input.platform,
    JSON.stringify(input.publicKeyJwk),
    JSON.stringify([...new Set(input.scopes)]),
    createdAt,
  );
  return getDevice(id)!;
}

export function getDevice(deviceId: string): DeviceRecord | undefined {
  const row = getSqliteDatabase().prepare('SELECT * FROM devices WHERE device_id = ?')
    .get(deviceId) as DeviceRow | undefined;
  return row ? deviceFromRow(row) : undefined;
}

export function listDevices(): DeviceRecord[] {
  return (getSqliteDatabase().prepare('SELECT * FROM devices ORDER BY created_at DESC')
    .all() as unknown as DeviceRow[]).map(deviceFromRow);
}

function issueAccessToken(deviceId: string, now: number): Pick<
  DeviceTokenPair,
  'accessToken' | 'accessTokenExpiresAt'
> {
  const accessSessionId = crypto.randomUUID();
  const accessToken = buildToken(ACCESS_TOKEN_PREFIX, accessSessionId);
  const accessTokenExpiresAt = now + ACCESS_TOKEN_TTL_MS;
  getSqliteDatabase().prepare(`
    INSERT INTO device_access_sessions (
      session_id, device_id, token_hash, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(accessSessionId, deviceId, tokenHash(accessToken), accessTokenExpiresAt, now);
  return { accessToken, accessTokenExpiresAt };
}

export function issueDeviceTokenPair(deviceId: string, now = Date.now()): DeviceTokenPair {
  const device = getDevice(deviceId);
  if (!device || device.revokedAt !== undefined) throw new Error('Device is unavailable');

  const refreshCredentialId = crypto.randomUUID();
  const refreshToken = buildToken(REFRESH_TOKEN_PREFIX, refreshCredentialId);
  const refreshTokenExpiresAt = now + REFRESH_TOKEN_TTL_MS;

  const access = runSqliteWriteTransaction((db) => {
    const issuedAccess = issueAccessToken(deviceId, now);
    db.prepare(`
      INSERT INTO device_refresh_credentials (
        credential_id, device_id, token_hash, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(refreshCredentialId, deviceId, tokenHash(refreshToken), refreshTokenExpiresAt, now);
    return issuedAccess;
  });

  return { ...access, refreshToken, refreshTokenExpiresAt };
}

/** Registers a phone-generated bootstrap credential without persisting its secret. */
export function registerInitialDeviceRefreshToken(deviceId: string, token: string, now = Date.now()): number {
  initialDeviceRefreshTokenSchema.parse(token);
  const parsed = parseToken(token, REFRESH_TOKEN_PREFIX)!;
  const expiresAt = now + REFRESH_TOKEN_TTL_MS;
  getSqliteDatabase().prepare(`INSERT INTO device_refresh_credentials
    (credential_id, device_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(parsed.id, deviceId, tokenHash(token), expiresAt, now);
  return expiresAt;
}

export function authenticateDeviceAccessToken(
  token: string,
  now = Date.now(),
): DeviceAccessIdentity | undefined {
  const parsed = parseToken(token, ACCESS_TOKEN_PREFIX);
  if (!parsed) return undefined;
  const row = getSqliteDatabase().prepare(`
    SELECT a.session_id, a.device_id, a.token_hash, a.expires_at, a.revoked_at,
           d.scopes_json, d.revoked_at AS device_revoked_at
    FROM device_access_sessions a
    JOIN devices d ON d.device_id = a.device_id
    WHERE a.session_id = ?
  `).get(parsed.id) as {
    session_id: string;
    device_id: string;
    token_hash: string;
    expires_at: number;
    revoked_at: number | null;
    scopes_json: string;
    device_revoked_at: number | null;
  } | undefined;
  if (
    !row
    || row.expires_at <= now
    || row.revoked_at !== null
    || row.device_revoked_at !== null
    || !crypto.timingSafeEqual(Buffer.from(row.token_hash, 'hex'), Buffer.from(tokenHash(token), 'hex'))
  ) {
    return undefined;
  }
  getSqliteDatabase().prepare('UPDATE devices SET last_seen_at = ? WHERE device_id = ?')
    .run(now, row.device_id);
  return {
    deviceId: row.device_id,
    accessSessionId: row.session_id,
    scopes: parseGatewayScopes(row.scopes_json),
  };
}

export function buildRefreshProofMessage(input: {
  credentialId: string;
  timestamp: number;
  nonce: string;
  requestId: string;
  nextRefreshToken: string;
}): string {
  return `xopc-device-refresh-v2\n${input.credentialId}\n${input.timestamp}\n${input.nonce}\n${input.requestId}\n${input.nextRefreshToken}`;
}

function verifyRefreshProof(
  publicKeyJwk: DevicePublicKeyJwk,
  message: string,
  signature: string,
): boolean {
  try {
    const publicKey = crypto.createPublicKey({ key: publicKeyJwk, format: 'jwk' });
    return crypto.verify(
      'sha256',
      Buffer.from(message),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

export function rotateDeviceRefreshToken(input: {
  refreshToken: string;
  timestamp: number;
  nonce: string;
  requestId: string;
  nextRefreshToken: string;
  signature: string;
  now?: number;
}): DeviceTokenPair {
  const now = input.now ?? Date.now();
  const parsed = parseToken(input.refreshToken, REFRESH_TOKEN_PREFIX);
  const nextParsed = parseToken(input.nextRefreshToken, REFRESH_TOKEN_PREFIX);
  if (!parsed || !nextParsed || parsed.id === nextParsed.id) throw new Error('Invalid refresh credential');
  if (Math.abs(now - input.timestamp) > REFRESH_PROOF_MAX_AGE_MS) {
    throw new Error('Refresh proof expired');
  }

  const result = runSqliteWriteTransaction((db): DeviceTokenPair | 'reused' => {
    const credential = db.prepare(`
      SELECT credential_id, device_id, token_hash, expires_at, replaced_by,
             rotation_request_id, revoked_at
      FROM device_refresh_credentials WHERE credential_id = ?
    `).get(parsed.id) as RefreshCredentialRow | undefined;
    const suppliedHash = tokenHash(input.refreshToken);
    if (!credential || credential.token_hash !== suppliedHash) throw new Error('Invalid refresh credential');
    const deviceRow = db.prepare('SELECT * FROM devices WHERE device_id = ?')
      .get(credential.device_id) as DeviceRow | undefined;
    if (!deviceRow || deviceRow.revoked_at !== null) throw new Error('Device is unavailable');
    const message = buildRefreshProofMessage({
      credentialId: credential.credential_id,
      timestamp: input.timestamp,
      nonce: input.nonce,
      requestId: input.requestId,
      nextRefreshToken: input.nextRefreshToken,
    });
    if (!verifyRefreshProof(JSON.parse(deviceRow.public_key_jwk) as DevicePublicKeyJwk, message, input.signature)) {
      throw new Error('Invalid refresh proof');
    }
    if (
      credential.replaced_by === nextParsed.id
      && credential.rotation_request_id === input.requestId
    ) {
      const nextCredential = db.prepare(`
        SELECT credential_id, device_id, token_hash, expires_at, replaced_by,
               rotation_request_id, revoked_at
        FROM device_refresh_credentials WHERE credential_id = ?
      `).get(nextParsed.id) as RefreshCredentialRow | undefined;
      if (nextCredential?.token_hash === tokenHash(input.nextRefreshToken)
        && nextCredential.revoked_at === null && nextCredential.replaced_by === null
        && nextCredential.expires_at > now) {
        const access = issueAccessToken(credential.device_id, now);
        return {
          ...access,
          refreshToken: input.nextRefreshToken,
          refreshTokenExpiresAt: nextCredential.expires_at,
        };
      }
    }
    if (credential.replaced_by !== null || credential.revoked_at !== null) {
      db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL')
        .run(now, credential.device_id);
      db.prepare('UPDATE device_access_sessions SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL')
        .run(now, credential.device_id);
      db.prepare('UPDATE device_refresh_credentials SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL')
        .run(now, credential.device_id);
      return 'reused';
    }
    if (credential.expires_at <= now) throw new Error('Refresh credential expired');
    const access = issueAccessToken(credential.device_id, now);
    const refreshTokenExpiresAt = now + REFRESH_TOKEN_TTL_MS;
    db.prepare(`
      INSERT INTO device_refresh_credentials (
        credential_id, device_id, token_hash, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(nextParsed.id, credential.device_id, tokenHash(input.nextRefreshToken), refreshTokenExpiresAt, now);
    db.prepare(`
      UPDATE device_refresh_credentials
      SET last_used_at = ?, replaced_by = ?, rotation_request_id = ?, revoked_at = ?
      WHERE credential_id = ?
    `).run(now, nextParsed.id, input.requestId, now, credential.credential_id);
    return {
      ...access,
      refreshToken: input.nextRefreshToken,
      refreshTokenExpiresAt,
    };
  });
  if (result === 'reused') throw new Error('Refresh credential reuse detected');
  return result;
}

export function revokeDevice(deviceId: string, now = Date.now()): boolean {
  return runSqliteWriteTransaction((db) => {
    const changed = db.prepare(
      'UPDATE devices SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL',
    ).run(now, deviceId).changes > 0;
    db.prepare('UPDATE device_access_sessions SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL')
      .run(now, deviceId);
    db.prepare('UPDATE device_refresh_credentials SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL')
      .run(now, deviceId);
    db.prepare('DELETE FROM device_push_endpoints WHERE device_id = ?').run(deviceId);
    return changed;
  });
}
