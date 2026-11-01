import { createHash, createPublicKey, verify } from 'node:crypto';

import { desktopExecutionGrantSchema, desktopExecutionStopSigningPayload, signedDesktopExecutionStopSchema, type SignedDesktopExecutionStop } from '@xopcai/gateway-contract';
import { canonicalJson } from '@xopcai/endpoint-tools-protocol';

import { getDevice } from './device-access-repository.js';
import { desktopExecutionRow, revokeDesktopExecutionRow } from './desktop-execution-state.js';
import { getOrCreateGatewayIdentity } from './gateway-identity-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

const digest = (json: string) => createHash('sha256').update(json).digest('hex');

/** The device key remains valid only for stopping its exact historical grant after revocation, never for access or execution. */
export function recordDesktopExecutionStop(input: SignedDesktopExecutionStop, now = Date.now()) {
  const signed = signedDesktopExecutionStopSchema.parse(input), receipt = signed.receipt;
  const device = getDevice(receipt.deviceId);
  if (!device || device.platform !== 'desktop' || receipt.gatewayId !== getOrCreateGatewayIdentity().id
    || !verify('sha256', Buffer.from(desktopExecutionStopSigningPayload(receipt)),
      { key: createPublicKey({ key: device.publicKeyJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(signed.signature, 'base64url'))) throw new Error('DESKTOP_STOP_INVALID');
  return runSqliteWriteTransaction(db => {
    const currentDevice = getDevice(receipt.deviceId);
    if (!currentDevice || currentDevice.platform !== 'desktop' || canonicalJson(currentDevice.publicKeyJwk) !== canonicalJson(device.publicKeyJwk)) throw new Error('DESKTOP_STOP_INVALID');
    const event = db.prepare("SELECT grant_json FROM desktop_execution_grant_events WHERE device_id=? AND grant_id=? AND revision=? AND action='granted'")
      .get(receipt.deviceId, receipt.grantId, receipt.authorizationRevision) as { grant_json: string } | undefined;
    if (!event) throw new Error('DESKTOP_STOP_INVALID');
    const grant = desktopExecutionGrantSchema.parse(JSON.parse(event.grant_json));
    if (grant.grantId !== receipt.grantId) throw new Error('DESKTOP_STOP_INVALID');
    const json = canonicalJson(signed), grantDigest = digest(event.grant_json);
    const previous = db.prepare('SELECT receipt_json,grant_digest FROM desktop_execution_stops WHERE device_id=? AND grant_id=? AND authorization_revision=?')
      .get(receipt.deviceId, receipt.grantId, receipt.authorizationRevision) as { receipt_json: string; grant_digest: string } | undefined;
    if (previous && (canonicalJson(signedDesktopExecutionStopSchema.parse(JSON.parse(previous.receipt_json)).receipt) !== canonicalJson(receipt) || previous.grant_digest !== grantDigest)
      || db.prepare('SELECT 1 FROM desktop_execution_stops WHERE stop_id=? AND (device_id<>? OR grant_id<>? OR authorization_revision<>?)')
        .get(receipt.stopId, receipt.deviceId, receipt.grantId, receipt.authorizationRevision)) throw new Error('DESKTOP_STOP_CONFLICT');
    const row = desktopExecutionRow(db, receipt.deviceId);
    const revokedCurrent = Boolean(row?.active && row.grant_id === receipt.grantId);
    if (revokedCurrent) {
      revokeDesktopExecutionRow(db, receipt.deviceId, now);
      db.prepare('UPDATE devices SET scopes_json=? WHERE device_id=?').run(JSON.stringify(currentDevice.scopes.filter(scope => scope !== 'desktop.execute')), receipt.deviceId);
    }
    if (!previous) db.prepare('INSERT INTO desktop_execution_stops(device_id,grant_id,authorization_revision,stop_id,receipt_json,grant_digest,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(receipt.deviceId, receipt.grantId, receipt.authorizationRevision, receipt.stopId, json, grantDigest, now);
    return { stopId: receipt.stopId, gatewayId: receipt.gatewayId, deviceId: receipt.deviceId, grantId: receipt.grantId,
      authorizationRevision: receipt.authorizationRevision, stopped: true as const, revokedCurrent };
  });
}

/** Releases only stale session admission. Unknown operations keep their original state and replay prohibition. */
export function hasVerifiedDesktopExecutionStop(scope: { gatewayId: string; deviceId: string; authorizationRevision: number; tool: string; toolRevision: string }): boolean {
  if (scope.gatewayId !== getOrCreateGatewayIdentity().id) return false;
  const row = getSqliteDatabase().prepare(`SELECT s.receipt_json,s.grant_digest,e.grant_json FROM desktop_execution_stops s
    JOIN desktop_execution_grant_events e ON e.device_id=s.device_id AND e.grant_id=s.grant_id AND e.revision=s.authorization_revision AND e.action='granted'
    WHERE s.device_id=? AND s.authorization_revision=?`).get(scope.deviceId, scope.authorizationRevision) as { receipt_json: string; grant_digest: string; grant_json: string } | undefined;
  if (!row || row.grant_digest !== digest(row.grant_json)) return false;
  const { receipt } = signedDesktopExecutionStopSchema.parse(JSON.parse(row.receipt_json));
  const grant = desktopExecutionGrantSchema.parse(JSON.parse(row.grant_json));
  const current = desktopExecutionRow(getSqliteDatabase(), scope.deviceId);
  return receipt.gatewayId === scope.gatewayId && receipt.deviceId === scope.deviceId && receipt.authorizationRevision === scope.authorizationRevision
    && receipt.grantId === grant.grantId && grant.toolRevisions[scope.tool as keyof typeof grant.toolRevisions] === scope.toolRevision
    && !(current?.active && current.grant_id === receipt.grantId);
}
