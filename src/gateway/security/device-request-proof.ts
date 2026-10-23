import crypto from 'node:crypto';

import type { DeviceRecord } from '../../storage/sqlite/device-access-repository.js';
import { getDevice } from '../../storage/sqlite/device-access-repository.js';
import { getOrCreateGatewayIdentity } from '../../storage/sqlite/gateway-identity-repository.js';
import { runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';

export const REQUEST_PROOF_WINDOW_MS = 120_000;
export const PROOF_HEADER = 'X-Xopc-Proof';
export const SIGNED_REQUEST_HEADERS = ['content-type', 'idempotency-key', 'x-xopc-expected-session-key', 'x-endpoint-id', 'x-endpoint-upload-token'] as const;
const MAX_PENDING_NONCES = 100_000;
const nonceBudgets = new WeakMap<object, { cleanupAt: number; total: number }>();

let activeProofBodies = 0;
const activeDeviceBodies = new Map<string, number>();

/** Bounds buffered uploads through route completion, after signature verification. */
export function acquireProofBodyBudget(deviceId: string): (() => void) | undefined {
  const count = activeDeviceBodies.get(deviceId) ?? 0;
  if (activeProofBodies >= 16 || count >= 8) return undefined;
  activeProofBodies++; activeDeviceBodies.set(deviceId, count + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false; activeProofBodies--;
    const remaining = (activeDeviceBodies.get(deviceId) ?? 1) - 1;
    if (remaining) activeDeviceBodies.set(deviceId, remaining); else activeDeviceBodies.delete(deviceId);
  };
}

export function proofDigest(bytes: crypto.BinaryLike): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export interface RequestProof {
  timestamp: number;
  nonce: string;
  digest: string;
  signature: string;
}

export function parseRequestProof(header: string | undefined): RequestProof | undefined {
  if (!header || header.length > 256) return undefined;
  const parts = header.split('.');
  if (parts.length !== 4 || !/^\d{13}$/.test(parts[0]) || !/^[A-Za-z0-9_-]{22,64}$/.test(parts[1])
    || !/^[a-f0-9]{64}$/.test(parts[2]) || !/^[A-Za-z0-9_-]{86}$/.test(parts[3])) return undefined;
  return { timestamp: Number(parts[0]), nonce: parts[1], digest: parts[2], signature: parts[3] };
}

export function requestProofMessage(input: {
  gatewayId: string; credential: string; method: string; target: string;
  headers: (name: string) => string | undefined; proof: Pick<RequestProof, 'timestamp' | 'nonce' | 'digest'>;
}): string {
  return ['xopc-request-v1', input.gatewayId, proofDigest(input.credential), input.method, input.target,
    input.proof.digest, ...SIGNED_REQUEST_HEADERS.map(name => input.headers(name) ?? ''),
    String(input.proof.timestamp), input.proof.nonce].join('\n');
}

export function verifyRequestProofSignature(device: DeviceRecord, proof: RequestProof, message: string): boolean {
  try {
    const key = crypto.createPublicKey({ key: device.publicKeyJwk, format: 'jwk' });
    return crypto.verify('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(proof.signature, 'base64url'));
  } catch { return false; }
}

/** The unique insert happens before business effects; expiry includes future-dated proofs. */
export function consumeRequestNonce(deviceId: string, proof: RequestProof, now = Date.now()): boolean {
  return runSqliteWriteTransaction(db => {
    let budget = nonceBudgets.get(db);
    if (!budget || now >= budget.cleanupAt) {
      db.prepare('DELETE FROM device_request_nonces WHERE expires_at < ?').run(now);
      const count = db.prepare('SELECT count(*) AS total FROM device_request_nonces').get() as { total: number };
      budget = { cleanupAt: now + 30_000, total: count.total };
      nonceBudgets.set(db, budget);
    }
    if (Math.abs(now - proof.timestamp) > REQUEST_PROOF_WINDOW_MS || budget.total >= MAX_PENDING_NONCES) return false;
    const inserted = db.prepare('INSERT OR IGNORE INTO device_request_nonces (device_id, nonce, expires_at) VALUES (?, ?, ?)')
      .run(deviceId, proof.nonce, proof.timestamp + REQUEST_PROOF_WINDOW_MS).changes === 1;
    if (inserted) budget.total++;
    return inserted;
  });
}

/** Native WebSocket upgrades bind the first ticket to the device key without another round trip. */
export function verifyDeviceConnectionProof(principalId: string, ticket: string, path: string, header: string | undefined): boolean {
  let device: DeviceRecord | undefined;
  try { device = getDevice(principalId); } catch { return false; }
  if (!device) return !header;
  if (device.revokedAt !== undefined) return false;
  if (device.requestProofVersion !== 1) return false;
  const proof = parseRequestProof(header);
  if (!proof || Math.abs(Date.now() - proof.timestamp) > REQUEST_PROOF_WINDOW_MS || proof.digest !== proofDigest('')) return false;
  const message = requestProofMessage({ gatewayId: getOrCreateGatewayIdentity().id, credential: ticket,
    method: 'CONNECT', target: path, headers: () => undefined, proof });
  return verifyRequestProofSignature(device, proof, message) && consumeRequestNonce(device.id, proof);
}
