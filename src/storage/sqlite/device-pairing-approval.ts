import crypto from 'node:crypto';

import {
  buildDevicePairingProof, devicePairingCompleteSchema, devicePairingDeviceSchema,
  type DevicePairingAction, type DevicePairingState, type DevicePairingStatus,
} from '@xopcai/gateway-contract';

import { DEFAULT_MOBILE_SCOPES } from '../../gateway/security/gateway-scopes.js';
import { createDevice, getDevice, revokeDevice, registerInitialDeviceRefreshToken } from './device-access-repository.js';
import type { DeviceRoute } from './device-pairing-repository.js';
import { getOrCreateGatewayIdentity } from './gateway-identity-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

const PROOF_WINDOW_MS = 5 * 60_000;
const APPROVAL_WINDOW_MS = 2 * 60_000;
const RECOVERY_WINDOW_MS = 24 * 60 * 60_000;
type SetupRow = {
  pairing_id: string; secret_hash: string; routes_json: string; expires_at: number;
  protocol_version: number; consumed_at: number | null; attempts_remaining: number;
};
type RequestRow = {
  request_id: string; pairing_id: string; device_json: string; status: DevicePairingState;
  revision: number; confirmation_code: string; expires_at: number; recovery_until: number;
  completion_key: string | null; initial_token_hash: string | null; device_id: string | null;
};

export class DevicePairingError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 401 | 404 | 409 = 409) {
    super(code);
  }
}
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const fail = (code: string, status?: 400 | 401 | 404 | 409): never => { throw new DevicePairingError(code, status); };

function requestRow(id: string, now: number): RequestRow {
  const db = getSqliteDatabase();
  db.prepare(`UPDATE device_pairing_requests SET status = 'expired', revision = revision + 1
    WHERE request_id = ? AND expires_at <= ? AND status IN ('pending', 'approved')`).run(id, now);
  const row = db.prepare('SELECT * FROM device_pairing_requests WHERE request_id = ?').get(id) as RequestRow | undefined;
  if (!row) return fail('PAIRING_NOT_FOUND', 404);
  return row;
}

function statusFromRow(row: RequestRow, now: number): DevicePairingStatus {
  const device = devicePairingDeviceSchema.parse(JSON.parse(row.device_json));
  return {
    requestId: row.request_id, setupId: row.pairing_id, status: row.status, revision: row.revision,
    displayName: device.displayName, platform: device.platform, confirmationCode: row.confirmation_code,
    expiresAt: row.expires_at, serverTime: now, ...(row.device_id ? { deviceId: row.device_id } : {}),
  };
}

function verifiedSetup(token: string, now: number): SetupRow {
  const id = /^xopc_pair_([0-9a-f-]{36})_/i.exec(token)?.[1];
  if (!id) return fail('PAIRING_DENIED', 401);
  const row = getSqliteDatabase().prepare('SELECT * FROM device_pairing_sessions WHERE pairing_id = ?')
    .get(id) as SetupRow | undefined;
  if (!row || row.protocol_version !== 3 || row.attempts_remaining <= 0) return fail('PAIRING_DENIED', 401);
  if (!crypto.timingSafeEqual(Buffer.from(row.secret_hash, 'hex'), Buffer.from(hash(token), 'hex'))) {
    getSqliteDatabase().prepare('UPDATE device_pairing_sessions SET attempts_remaining = attempts_remaining - 1 WHERE pairing_id = ?')
      .run(id);
    return fail('PAIRING_DENIED', 401);
  }
  if (now > row.expires_at + RECOVERY_WINDOW_MS) return fail('PAIRING_EXPIRED');
  return row;
}

function verifyProof(action: DevicePairingAction, body: Record<string, unknown>, deviceJson: string, now: number): void {
  if (body.gatewayId !== getOrCreateGatewayIdentity().id) fail('PAIRING_IDENTITY_MISMATCH', 401);
  if (typeof body.timestamp !== 'number' || Math.abs(now - body.timestamp) > PROOF_WINDOW_MS) fail('PAIRING_PROOF_EXPIRED', 401);
  const device = devicePairingDeviceSchema.parse(JSON.parse(deviceJson));
  let valid = false;
  try {
    valid = crypto.verify('sha256', Buffer.from(buildDevicePairingProof(action, body)), {
      key: crypto.createPublicKey({ key: device.publicKeyJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363',
    }, Buffer.from(String(body.signature), 'base64url'));
  } catch { /* Invalid public keys and signatures are rejected uniformly. */ }
  if (!valid) fail('PAIRING_DENIED', 401);
}

export function submitDevicePairingRequest(body: Record<string, unknown>, now = Date.now()): DevicePairingStatus {
  const setup = verifiedSetup(String(body.pairingToken), now);
  const device = devicePairingDeviceSchema.parse(body.device);
  const deviceJson = JSON.stringify(device);
  verifyProof('request', body, deviceJson, now);
  return runSqliteWriteTransaction((db) => {
    const existing = db.prepare('SELECT request_id, device_json FROM device_pairing_requests WHERE pairing_id = ?')
      .get(setup.pairing_id) as { request_id: string; device_json: string } | undefined;
    if (existing) {
      if (existing.request_id !== body.requestId || existing.device_json !== deviceJson) return fail('PAIRING_BUSY');
      return statusFromRow(requestRow(existing.request_id, now), now);
    }
    if (setup.consumed_at !== null) return fail('PAIRING_CANCELLED');
    if (setup.expires_at <= now) return fail('PAIRING_EXPIRED');
    const expiresAt = Math.min(setup.expires_at, now + APPROVAL_WINDOW_MS);
    db.prepare(`INSERT INTO device_pairing_requests (request_id, pairing_id, device_json, status,
      confirmation_code, expires_at, recovery_until, created_at) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`)
      .run(String(body.requestId), setup.pairing_id, deviceJson, crypto.randomInt(0, 1_000_000).toString().padStart(6, '0'),
        expiresAt, setup.expires_at + RECOVERY_WINDOW_MS, now);
    return statusFromRow(requestRow(String(body.requestId), now), now);
  });
}

export function readDevicePairingSetup(setupId: string, now = Date.now()): { request: DevicePairingStatus | null; serverTime: number } {
  const setup = getSqliteDatabase().prepare('SELECT pairing_id FROM device_pairing_sessions WHERE pairing_id = ?').get(setupId);
  if (!setup) return fail('PAIRING_NOT_FOUND', 404);
  const row = getSqliteDatabase().prepare('SELECT request_id FROM device_pairing_requests WHERE pairing_id = ?')
    .get(setupId) as { request_id: string } | undefined;
  return { request: row ? statusFromRow(requestRow(row.request_id, now), now) : null, serverTime: now };
}

export function decideDevicePairingRequest(id: string, decision: 'approve' | 'reject', revision: number, now = Date.now()): DevicePairingStatus {
  return runSqliteWriteTransaction((db) => {
    const row = requestRow(id, now);
    if (row.revision !== revision || row.status !== 'pending') return fail('PAIRING_CHANGED');
    db.prepare(`UPDATE device_pairing_requests SET status = ?, revision = revision + 1 WHERE request_id = ?`)
      .run(decision === 'approve' ? 'approved' : 'rejected', id);
    return statusFromRow(requestRow(id, now), now);
  });
}

export function cancelDevicePairingSetup(id: string, now = Date.now()): void {
  runSqliteWriteTransaction((db) => {
    db.prepare('UPDATE device_pairing_sessions SET consumed_at = ? WHERE pairing_id = ? AND consumed_at IS NULL').run(now, id);
    db.prepare(`UPDATE device_pairing_requests SET status = 'cancelled', revision = revision + 1
      WHERE pairing_id = ? AND status IN ('pending', 'approved')`).run(id);
  });
}

export function operateDevicePairingRequest(action: Exclude<DevicePairingAction, 'request'>, body: Record<string, unknown>, now = Date.now()): {
  request: DevicePairingStatus; routes: DeviceRoute[]; scopes?: readonly string[];
} {
  const setup = verifiedSetup(String(body.pairingToken), now);
  const row = requestRow(String(body.requestId), now);
  if (row.pairing_id !== setup.pairing_id) return fail('PAIRING_DENIED', 401);
  verifyProof(action, body, row.device_json, now);
  if (action !== 'cancel' && row.device_id && getDevice(row.device_id)?.revokedAt !== undefined) return fail('DEVICE_REVOKED', 401);
  if (now >= row.recovery_until) return fail('PAIRING_EXPIRED');
  if (action === 'cancel') {
    runSqliteWriteTransaction((db) => {
      if (row.device_id) revokeDevice(row.device_id, now);
      cancelDevicePairingSetup(row.pairing_id, now);
      db.prepare("UPDATE device_pairing_requests SET status = 'cancelled' WHERE request_id = ?").run(row.request_id);
    });
  } else if (action === 'complete') {
    const complete = devicePairingCompleteSchema.parse(body);
    runSqliteWriteTransaction((db) => {
      const current = requestRow(row.request_id, now);
      if (current.status === 'completed') {
        if (current.completion_key !== complete.idempotencyKey || current.initial_token_hash !== hash(complete.initialRefreshToken)) {
          fail('PAIRING_CHANGED');
        }
        return;
      }
      if (current.status !== 'approved') fail('PAIRING_NOT_APPROVED');
      const device = devicePairingDeviceSchema.parse(JSON.parse(current.device_json));
      const created = createDevice({ ...device, scopes: DEFAULT_MOBILE_SCOPES, now });
      registerInitialDeviceRefreshToken(created.id, complete.initialRefreshToken, now);
      db.prepare(`UPDATE device_pairing_requests SET status = 'completed', revision = revision + 1,
        completion_key = ?, initial_token_hash = ?, device_id = ? WHERE request_id = ?`)
        .run(complete.idempotencyKey, hash(complete.initialRefreshToken), created.id, current.request_id);
      db.prepare('UPDATE device_pairing_sessions SET consumed_at = ? WHERE pairing_id = ?').run(now, setup.pairing_id);
    });
  }
  return {
    request: statusFromRow(requestRow(row.request_id, now), now),
    routes: JSON.parse(setup.routes_json) as DeviceRoute[],
    ...(action === 'complete' ? { scopes: DEFAULT_MOBILE_SCOPES } : {}),
  };
}
