import { canonicalJson, desktopOperationIntentSchema, desktopOperationReceiptSchema, type DesktopOperationIntent, type DesktopOperationReceipt } from '@xopcai/endpoint-tools-protocol';

import { getDesktopExecutionGrant } from './desktop-execution-repository.js';
import { runSqliteWriteTransaction } from './transaction.js';

/** Persist the immutable intent before sending any command that may change the device. */
export function recordDesktopOperationIntent(input: DesktopOperationIntent, grantId: string, now = Date.now()): DesktopOperationIntent {
  const intent = desktopOperationIntentSchema.parse(input), json = canonicalJson(intent);
  return runSqliteWriteTransaction(db => {
    const grant = getDesktopExecutionGrant(intent.deviceId, now);
    const row = db.prepare(`SELECT principal_id, request_digest, descriptor_digest, state, lease_expires_at, desktop_intent_json
      FROM capability_operations WHERE operation_id=?`).get(intent.operationId) as {
        principal_id: string; request_digest: string; descriptor_digest: string; state: string; lease_expires_at: number | null; desktop_intent_json: string | null;
      } | undefined;
    if (!grant?.active || grant.grant?.grantId !== grantId || grant.revision !== intent.authorizationRevision
      || grant.grant.expiresAt < intent.expiresAt || intent.expiresAt <= now
      || !row || row.principal_id !== intent.deviceId || row.request_digest !== intent.argumentHash || row.descriptor_digest !== intent.toolRevision
      || row.state !== 'running' || (row.lease_expires_at ?? 0) <= now || (row.lease_expires_at ?? 0) < intent.expiresAt
      || row.desktop_intent_json !== null && row.desktop_intent_json !== json) throw new Error('DESKTOP_OPERATION_INTENT_INVALID');
    if (db.prepare(`SELECT 1 FROM capability_operations WHERE principal_id=? AND operation_id<>?
      AND desktop_intent_json IS NOT NULL AND state IN ('running','unknown') LIMIT 1`).get(intent.deviceId, intent.operationId)) {
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
