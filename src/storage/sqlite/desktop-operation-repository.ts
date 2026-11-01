import { createHash } from 'node:crypto';

import { REMOTE_COMPUTER_DESCRIPTOR, REMOTE_COMPUTER_CONTROL_TOOL } from '@xopcai/computer-control-contract';

import { desktopOperationReviewSchema, type DesktopOperationReview, canonicalJson, desktopOperationIntentSchema, desktopOperationReceiptSchema, type DesktopOperationIntent, type DesktopOperationReceipt } from '@xopcai/endpoint-tools-protocol';

import { getDevice } from './device-access-repository.js';
import { getDesktopExecutionGrant } from './desktop-execution-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

/** Persist the immutable intent before sending any command that may change the device. */
export function recordDesktopOperationIntent(input: DesktopOperationIntent, grantId: string, now = Date.now()): DesktopOperationIntent {
  const intent = desktopOperationIntentSchema.parse(input), json = canonicalJson(intent);
  return runSqliteWriteTransaction(db => {
    const grant = getDesktopExecutionGrant(intent.deviceId, now);
    const row = db.prepare(`SELECT principal_id, request_digest, descriptor_digest, state, recovery_mode, generation, lease_expires_at, desktop_intent_json
      FROM capability_operations WHERE operation_id=?`).get(intent.operationId) as {
        principal_id: string; request_digest: string; descriptor_digest: string; state: string; recovery_mode: string; generation: number; lease_expires_at: number | null; desktop_intent_json: string | null;
      } | undefined;
    if (!grant?.active || grant.grant?.grantId !== grantId || grant.revision !== intent.authorizationRevision
      || grant.grant.expiresAt < intent.expiresAt || intent.expiresAt <= now
      || grant.grant.workspaceId !== intent.workspaceId
      || !row || row.principal_id !== intent.deviceId || row.request_digest !== intent.argumentHash || row.descriptor_digest !== intent.toolRevision
      || row.generation !== 1 || row.recovery_mode !== 'manual' || row.state !== 'running' || (row.lease_expires_at ?? 0) <= now || (row.lease_expires_at ?? 0) < intent.expiresAt
      || row.desktop_intent_json !== null && row.desktop_intent_json !== json) throw new Error('DESKTOP_OPERATION_INTENT_INVALID');
    if (db.prepare(`SELECT 1 FROM capability_operations WHERE principal_id=? AND operation_id<>?
      AND desktop_intent_json IS NOT NULL AND (state='running' OR state='unknown' AND NOT EXISTS
        (SELECT 1 FROM desktop_operation_reviews r WHERE r.operation_id=capability_operations.operation_id)) LIMIT 1`).get(intent.deviceId, intent.operationId)) {
      throw new Error('DESKTOP_OPERATION_RECONCILIATION_REQUIRED');
    }
    db.prepare('UPDATE capability_operations SET desktop_intent_json=? WHERE operation_id=?').run(json, intent.operationId);
    return intent;
  });
}

/** Accept only terminal evidence for the already-recorded intent; this never authorizes a retry. */
export function recordDesktopOperationReceipt(intent: DesktopOperationIntent, input: DesktopOperationReceipt): void {
  const receipt = desktopOperationReceiptSchema.parse(input);
  if (receipt.operationId !== intent.operationId || !['succeeded', 'failed', 'stopped', 'unknown'].includes(receipt.state)) throw new Error('DESKTOP_OPERATION_RECEIPT_INVALID');
  runSqliteWriteTransaction(db => {
    const row = db.prepare('SELECT desktop_intent_json, desktop_receipt_json FROM capability_operations WHERE operation_id=?').get(intent.operationId) as {
      desktop_intent_json: string | null; desktop_receipt_json: string | null;
    } | undefined;
    const json = canonicalJson(receipt);
    if (row?.desktop_intent_json !== canonicalJson(intent) || row.desktop_receipt_json !== null && row.desktop_receipt_json !== json) throw new Error('DESKTOP_OPERATION_RECEIPT_INVALID');
    db.prepare('UPDATE capability_operations SET desktop_receipt_json=? WHERE operation_id=?').run(json, intent.operationId);
  });
}

/** Metadata lookup is scoped to the authenticated device and its pinned Gateway identity. */
export function getDesktopOperationIntent(operationId: string, deviceId: string, gatewayId: string): DesktopOperationIntent | undefined {
  const row = getSqliteDatabase().prepare('SELECT desktop_intent_json FROM capability_operations WHERE operation_id=? AND principal_id=?')
    .get(operationId, deviceId) as { desktop_intent_json: string | null } | undefined;
  if (!row?.desktop_intent_json) return;
  const intent = desktopOperationIntentSchema.parse(JSON.parse(row.desktop_intent_json));
  return intent.gatewayId === gatewayId && intent.deviceId === deviceId && intent.operationId === operationId ? intent : undefined;
}

export function getDesktopOperationReceipt(operationId: string, deviceId: string, gatewayId: string): DesktopOperationReceipt | undefined {
  if (!getDesktopOperationIntent(operationId, deviceId, gatewayId)) return;
  const row = getSqliteDatabase().prepare('SELECT desktop_receipt_json FROM capability_operations WHERE operation_id=? AND principal_id=?').get(operationId, deviceId) as { desktop_receipt_json: string | null } | undefined;
  if (!row?.desktop_receipt_json) return;
  const receipt = desktopOperationReceiptSchema.parse(JSON.parse(row.desktop_receipt_json));
  if (receipt.operationId !== operationId) throw new Error('DESKTOP_OPERATION_RECEIPT_INVALID');
  return receipt;
}

export function listDesktopOperationsForReview(deviceId: string, gatewayId: string) {
  return (getSqliteDatabase().prepare(`SELECT o.operation_id, o.generation, o.desktop_intent_json, o.desktop_receipt_json
    FROM capability_operations o LEFT JOIN desktop_operation_reviews r ON r.operation_id=o.operation_id
    WHERE o.principal_id=? AND o.state='unknown' AND o.desktop_intent_json IS NOT NULL AND r.operation_id IS NULL
    ORDER BY o.created_at,o.operation_id LIMIT 8`).all(deviceId) as { operation_id: string; generation: number; desktop_intent_json: string; desktop_receipt_json: string | null }[])
    .map(row => {
      const intent = desktopOperationIntentSchema.parse(JSON.parse(row.desktop_intent_json));
      if (intent.deviceId !== deviceId || intent.gatewayId !== gatewayId || intent.operationId !== row.operation_id) throw new Error('DESKTOP_OPERATION_IDENTITY_MISMATCH');
      return { intent, generation: row.generation, ...(row.desktop_receipt_json ? { receipt: desktopOperationReceiptSchema.parse(JSON.parse(row.desktop_receipt_json)) } : {}) };
    });
}

export function reviewDesktopOperation(operationId: string, deviceId: string, gatewayId: string, input: DesktopOperationReview, now = Date.now()) {
  const review = desktopOperationReviewSchema.parse(input);
  return runSqliteWriteTransaction(db => {
    const device = getDevice(deviceId);
    if (!device || device.platform !== 'desktop' || device.revokedAt !== undefined || !device.scopes.includes('device.self')) throw new Error('DESKTOP_OPERATION_REVIEW_CONFLICT');
    const intent = getDesktopOperationIntent(operationId, deviceId, gatewayId);
    const row = db.prepare('SELECT state,generation FROM capability_operations WHERE operation_id=? AND principal_id=?').get(operationId, deviceId) as { state: string; generation: number } | undefined;
    if (!intent || !row || row.state !== 'unknown' || row.generation !== review.expectedGeneration
      || review.intentFingerprint !== createHash('sha256').update(JSON.stringify(intent)).digest('hex')
      || review.receipt && review.receipt.operationId !== operationId
      || review.localStatus === 'not-found' && !(intent.tool === 'desktop.clipboard.write' || intent.tool === REMOTE_COMPUTER_CONTROL_TOOL && !intent.workspaceId
        && intent.toolRevision === createHash('sha256').update(canonicalJson(REMOTE_COMPUTER_DESCRIPTOR)).digest('hex') || ['desktop.workspace.write', 'desktop.command.run', 'desktop.terminal.open'].includes(intent.tool) && intent.workspaceId)) throw new Error('DESKTOP_OPERATION_REVIEW_CONFLICT');
    const json = canonicalJson(review), previous = db.prepare('SELECT review_id,observation_json FROM desktop_operation_reviews WHERE operation_id=?').get(operationId) as { review_id: string; observation_json: string } | undefined;
    if (previous) {
      if (previous.review_id !== review.reviewId || previous.observation_json !== json) throw new Error('DESKTOP_OPERATION_REVIEW_CONFLICT');
      return { operationId, reviewed: true as const, outcome: 'unknown' as const, reviewId: review.reviewId };
    }
    if (db.prepare('SELECT 1 FROM desktop_operation_reviews WHERE review_id=?').get(review.reviewId)) throw new Error('DESKTOP_OPERATION_REVIEW_CONFLICT');
    db.prepare(`INSERT INTO desktop_operation_reviews(operation_id,device_id,review_id,generation,intent_fingerprint,observation_json,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(operationId,deviceId,review.reviewId,row.generation,review.intentFingerprint,json,now);
    return { operationId, reviewed: true as const, outcome: 'unknown' as const, reviewId: review.reviewId };
  });
}

export function getDesktopOperationForReview(operationId: string, deviceId: string, gatewayId: string) {
  const intent = getDesktopOperationIntent(operationId, deviceId, gatewayId);
  if (!intent) return;
  const row = getSqliteDatabase().prepare('SELECT state,generation FROM capability_operations WHERE operation_id=?').get(operationId) as { state: string; generation: number };
  const reviewed = getSqliteDatabase().prepare('SELECT observation_json FROM desktop_operation_reviews WHERE operation_id=? AND device_id=?').get(operationId,deviceId) as { observation_json: string } | undefined;
  return { intent, state: row.state, generation: row.generation, ...(reviewed ? { review: desktopOperationReviewSchema.parse(JSON.parse(reviewed.observation_json)) } : {}) };
}
