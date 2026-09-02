import crypto from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

const PAIRING_TOKEN_PREFIX = 'xopc_pair_';
const PAIRING_TTL_MS = 10 * 60 * 1_000;
const PAIRING_ATTEMPTS = 5;

export type DeviceRoute = {
  id: string;
  kind: 'xopc-secure-link' | 'tailscale' | 'custom-https';
  url: string;
};

export type DevicePairingSetup = {
  id: string;
  token: string;
  routes: DeviceRoute[];
  expiresAt: number;
};

type PairingRow = {
  pairing_id: string;
  secret_hash: string;
  routes_json: string;
  expires_at: number;
  attempts_remaining: number;
  consumed_at: number | null;
};

export type PairingConsumeResult =
  | { ok: true; pairingId: string; routes: DeviceRoute[] }
  | { ok: false; reason: 'invalid' | 'expired' | 'consumed' };

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hashesMatch(left: string, right: string): boolean {
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function tokenId(token: string): string | undefined {
  if (!token.startsWith(PAIRING_TOKEN_PREFIX)) return undefined;
  const separator = token.indexOf('_', PAIRING_TOKEN_PREFIX.length);
  if (separator <= PAIRING_TOKEN_PREFIX.length || separator === token.length - 1) return undefined;
  return token.slice(PAIRING_TOKEN_PREFIX.length, separator);
}

export function createDevicePairingSetup(
  routes: readonly DeviceRoute[],
  now = Date.now(),
): DevicePairingSetup {
  if (routes.length === 0) throw new Error('No secure mobile route is available');
  const id = crypto.randomUUID();
  const token = `${PAIRING_TOKEN_PREFIX}${id}_${crypto.randomBytes(32).toString('base64url')}`;
  const expiresAt = now + PAIRING_TTL_MS;
  runSqliteWriteTransaction((db) => {
    db.prepare('DELETE FROM device_pairing_sessions WHERE expires_at <= ? OR consumed_at IS NOT NULL')
      .run(now);
    db.prepare(`
      INSERT INTO device_pairing_sessions (
        pairing_id, secret_hash, routes_json, expires_at, attempts_remaining, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, hashToken(token), JSON.stringify(routes), expiresAt, PAIRING_ATTEMPTS, now);
  });
  return { id, token, routes: [...routes], expiresAt };
}

export function consumeDevicePairingToken(token: string, now = Date.now()): PairingConsumeResult {
  const id = tokenId(token);
  if (!id) return { ok: false, reason: 'invalid' };
  return runSqliteWriteTransaction((db) => {
    const row = db.prepare('SELECT * FROM device_pairing_sessions WHERE pairing_id = ?')
      .get(id) as PairingRow | undefined;
    if (!row || row.attempts_remaining <= 0) return { ok: false, reason: 'invalid' };
    if (row.consumed_at !== null) return { ok: false, reason: 'consumed' };
    if (row.expires_at <= now) return { ok: false, reason: 'expired' };
    if (!hashesMatch(row.secret_hash, hashToken(token))) {
      db.prepare(`
        UPDATE device_pairing_sessions
        SET attempts_remaining = attempts_remaining - 1
        WHERE pairing_id = ? AND attempts_remaining > 0
      `).run(id);
      return { ok: false, reason: 'invalid' };
    }
    db.prepare('UPDATE device_pairing_sessions SET consumed_at = ? WHERE pairing_id = ?')
      .run(now, id);
    return {
      ok: true,
      pairingId: id,
      routes: JSON.parse(row.routes_json) as DeviceRoute[],
    };
  });
}

export function isDevicePairingSetupActive(pairingId: string, now = Date.now()): boolean {
  const row = getSqliteDatabase().prepare(`
    SELECT 1 FROM device_pairing_sessions
    WHERE pairing_id = ? AND expires_at > ? AND consumed_at IS NULL AND attempts_remaining > 0
  `).get(pairingId, now);
  return Boolean(row);
}
