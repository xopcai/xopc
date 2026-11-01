import { desktopExecutionGrantSchema, type DesktopExecutionGrant } from '@xopcai/gateway-contract';
import { canonicalJson } from '@xopcai/endpoint-tools-protocol';

import { getDevice, getDesktopStateObservation } from './device-access-repository.js';
import { desktopExecutionRow, recordDesktopExecutionEvent, revokeDesktopExecutionRow } from './desktop-execution-state.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export function getDesktopExecutionGrant(deviceId: string, now = Date.now()) {
  const device = getDevice(deviceId);
  if (!device || device.revokedAt !== undefined || device.platform !== 'desktop') return;
  const row = desktopExecutionRow(getSqliteDatabase(), deviceId);
  const grant = row ? desktopExecutionGrantSchema.parse(JSON.parse(row.grant_json)) : undefined;
  return { deviceId, revision: row?.revision ?? 0, enabled: row?.active === 1,
    active: row?.active === 1 && device.scopes.includes('desktop.execute') && grant!.expiresAt > now, ...(grant ? { grant } : {}) };
}

/** Input must have been approved locally and authenticated with this device's request proof. */
export function setDesktopExecutionGrant(deviceId: string, expectedRevision: number, input: DesktopExecutionGrant, now = Date.now()) {
  const grant = desktopExecutionGrantSchema.parse(input), json = canonicalJson(grant);
  if (grant.expiresAt <= now + 1000 || grant.expiresAt > now + 300000) throw new Error('DESKTOP_EXECUTION_GRANT_EXPIRED');
  return runSqliteWriteTransaction(db => {
    const device = getDevice(deviceId), row = desktopExecutionRow(db, deviceId);
    if (!device || device.revokedAt !== undefined || device.platform !== 'desktop') throw new Error('DESKTOP_EXECUTION_DEVICE_INVALID');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('DESKTOP_EXECUTION_REVISION_CHANGED');
    // Recover a lost acknowledgement only while the identical grant remains active.
    if (row?.active && row.grant_json === json) return getDesktopExecutionGrant(deviceId, now)!;
    if (expectedRevision !== (row?.revision ?? 0)) throw new Error('DESKTOP_EXECUTION_REVISION_CHANGED');
    if (db.prepare("SELECT 1 FROM desktop_execution_grant_events WHERE device_id=? AND action='granted' AND (grant_id=? OR approval_id=?)")
      .get(deviceId, grant.grantId, grant.localApprovalId)) throw new Error('DESKTOP_EXECUTION_APPROVAL_ALREADY_USED');
    const count = db.prepare('SELECT count(*) AS count FROM desktop_execution_grant_events WHERE device_id=?').get(deviceId)?.count as number;
    if (count + (row?.active ? 2 : 1) + 1 > 10000) throw new Error('DESKTOP_EXECUTION_GRANT_LIMIT');
    const revision = (row?.revision ?? 0) + 1, observation = getDesktopStateObservation(deviceId)!;
    if (!Number.isSafeInteger(revision) || !Number.isSafeInteger(observation.revision + 1)) throw new Error('DESKTOP_EXECUTION_REVISION_LIMIT');
    const next = { device_id: deviceId, revision, grant_id: grant.grantId, approval_id: grant.localApprovalId, grant_json: json, active: 1 };
    if (row?.active) recordDesktopExecutionEvent(db, { ...row, revision, active: 0 }, 'revoked', now);
    db.prepare(`INSERT INTO desktop_execution_grants(device_id,revision,grant_id,approval_id,grant_json,active,updated_at) VALUES (?,?,?,?,?,1,?)
      ON CONFLICT(device_id) DO UPDATE SET revision=excluded.revision,grant_id=excluded.grant_id,approval_id=excluded.approval_id,grant_json=excluded.grant_json,active=1,updated_at=excluded.updated_at`)
      .run(deviceId, revision, grant.grantId, grant.localApprovalId, json, now);
    recordDesktopExecutionEvent(db, next, 'granted', now);
    const scopes = device.scopes.filter(scope => !['desktop.observe.state', 'desktop.observe.screen', 'desktop.execute'].includes(scope));
    db.prepare('UPDATE devices SET scopes_json=? WHERE device_id=?').run(JSON.stringify([...scopes, 'desktop.execute']), deviceId);
    db.prepare(`INSERT INTO desktop_observation_grants(device_id,revision,updated_at) VALUES (?,?,?)
      ON CONFLICT(device_id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at`).run(deviceId, observation.revision + 1, now);
    return getDesktopExecutionGrant(deviceId, now)!;
  });
}

export function revokeDesktopExecutionGrant(deviceId: string, grantId: string, expectedRevision: number, now = Date.now()) {
  return runSqliteWriteTransaction(db => {
    const current = getDesktopExecutionGrant(deviceId, now), row = desktopExecutionRow(db, deviceId);
    if (!current || !row || row.grant_id !== grantId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
      || (row.active === 1 ? row.revision !== expectedRevision : expectedRevision > row.revision)) throw new Error('DESKTOP_EXECUTION_REVISION_CHANGED');
    revokeDesktopExecutionRow(db, deviceId, now);
    const device = getDevice(deviceId)!;
    db.prepare('UPDATE devices SET scopes_json=? WHERE device_id=?').run(JSON.stringify(device.scopes.filter(scope => scope !== 'desktop.execute')), deviceId);
    return getDesktopExecutionGrant(deviceId, now)!;
  });
}
