import crypto from 'node:crypto';

import type { DevicePairingTargetKind } from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

const PAIRING_TOKEN_PREFIX = 'xopc_pair_';
const PAIRING_TTL_MS = 10 * 60 * 1_000;
const PAIRING_ATTEMPTS = 5;

export type DeviceRoute = {
  id: string;
  kind: 'xopc-secure-link' | 'tailscale' | 'custom-https' | 'local-browser';
  url: string;
};

export type DevicePairingSetup = {
  id: string;
  token: string;
  routes: DeviceRoute[];
  expiresAt: number;
  targetKind: DevicePairingTargetKind;
};

export type DevicePairingEnrollment = {
  issuer: 'browser-native-host';
  extensionId: string;
  publicKeyThumbprint: string;
  nonce: string;
};

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createDevicePairingSetup(
  routes: readonly DeviceRoute[],
  now = Date.now(),
  options: {
    targetKind: DevicePairingTargetKind;
    ttlMs?: number;
    enrollment?: DevicePairingEnrollment;
  },
): DevicePairingSetup {
  if (routes.length === 0) throw new Error('No secure device route is available');
  const id = crypto.randomUUID();
  const token = `${PAIRING_TOKEN_PREFIX}${id}_${crypto.randomBytes(32).toString('base64url')}`;
  const expiresAt = now + (options?.ttlMs ?? PAIRING_TTL_MS);
  runSqliteWriteTransaction((db) => {
    db.prepare(`DELETE FROM device_pairing_sessions
      WHERE expires_at < ?`).run(now - 24 * 60 * 60_000);
    db.prepare(`
      INSERT INTO device_pairing_sessions (
        pairing_id, secret_hash, routes_json, expires_at, attempts_remaining, created_at
        , enrollment_issuer, enrollment_extension_id,
        enrollment_public_key_thumbprint, enrollment_nonce, target_kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, hashToken(token), JSON.stringify(routes), expiresAt, PAIRING_ATTEMPTS, now,
      options?.enrollment?.issuer ?? null,
      options?.enrollment?.extensionId ?? null,
      options?.enrollment?.publicKeyThumbprint ?? null,
      options?.enrollment?.nonce ?? null,
      options.targetKind,
    );
  });
  return { id, token, routes: [...routes], expiresAt, targetKind: options.targetKind };
}

export function isDevicePairingSetupActive(pairingId: string, now = Date.now()): boolean {
  const row = getSqliteDatabase().prepare(`
    SELECT 1 FROM device_pairing_sessions
    WHERE pairing_id = ? AND expires_at > ? AND consumed_at IS NULL AND attempts_remaining > 0
  `).get(pairingId, now);
  return Boolean(row);
}
