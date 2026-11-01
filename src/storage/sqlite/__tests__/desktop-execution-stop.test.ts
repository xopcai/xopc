import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { desktopExecutionStopSigningPayload, type DesktopExecutionStop } from '@xopcai/gateway-contract';
import { REMOTE_BROWSER_DESCRIPTOR } from '@xopcai/browser-control-contract/remote';
import { endpointToolRevision } from '@xopcai/endpoint-tools-client';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../connection.js';
import { createDevice, getDevice, revokeDevice } from '../device-access-repository.js';
import { getDesktopExecutionGrant, setDesktopExecutionGrant } from '../desktop-execution-repository.js';
import { hasVerifiedDesktopExecutionStop, recordDesktopExecutionStop } from '../desktop-execution-stop-repository.js';
import { getOrCreateGatewayIdentity } from '../gateway-identity-repository.js';
import { getSqliteDatabase } from '../transaction.js';
import { executeExternalOperation } from '../../../capabilities/runtime/external-operations.js';
import { listDesktopOperationsForReview, recordDesktopOperationIntent } from '../desktop-operation-repository.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'xopc-execution-stop-')); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(root, 'test.db') }); });
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const device = createDevice({ displayName: 'Stop fixture', platform: 'desktop', scopes: ['gateway.status', 'device.self'], publicKeyJwk: keys.publicKey.export({ format: 'jwk' }) });
  const toolRevision = endpointToolRevision(REMOTE_BROWSER_DESCRIPTOR as never), grantId = randomUUID();
  const grant = setDesktopExecutionGrant(device.id, 0, { version: 1, grantId, localApprovalId: randomUUID(), expiresAt: Date.now() + 120000, toolRevisions: { [REMOTE_BROWSER_DESCRIPTOR.name]: toolRevision } });
  const receipt: DesktopExecutionStop = { version: 1, gatewayId: getOrCreateGatewayIdentity().id, deviceId: device.id, grantId,
    authorizationRevision: grant.revision, stopId: randomUUID(), leaseGeneration: randomUUID(), executionStopped: true };
  const signed = (input = receipt, privateKey = keys.privateKey) => ({ receipt: input,
    signature: sign('sha256', Buffer.from(desktopExecutionStopSigningPayload(input)), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') });
  const scope = { gatewayId: receipt.gatewayId, deviceId: device.id, authorizationRevision: grant.revision, tool: REMOTE_BROWSER_DESCRIPTOR.name, toolRevision };
  return { device, grantId, receipt, signed, scope };
}
it('accepts an exact device-signed stop, revokes only its active grant and releases admission without changing business outcomes', () => {
  const f = fixture();
  expect(hasVerifiedDesktopExecutionStop(f.scope)).toBe(false);
  expect(recordDesktopExecutionStop(f.signed())).toMatchObject({ stopped: true, revokedCurrent: true });
  expect(getDesktopExecutionGrant(f.device.id)?.active).toBe(false); expect(getDevice(f.device.id)?.scopes).not.toContain('desktop.execute');
  expect(hasVerifiedDesktopExecutionStop(f.scope)).toBe(true);
  expect(recordDesktopExecutionStop(f.signed())).toMatchObject({ stopped: true, revokedCurrent: false });
  for (const patch of [{ deviceId: randomUUID() }, { gatewayId: randomUUID() }, { authorizationRevision: 99 }, { toolRevision: 'f'.repeat(64) }, { tool: 'computer.control' }]) expect(hasVerifiedDesktopExecutionStop({ ...f.scope, ...patch })).toBe(false);
  expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM capability_operations').get()?.n).toBe(0);
});
it('does not revoke a new grant when an old signed stop arrives late, and permits only stop metadata from a revoked device', () => {
  const f = fixture();
  const next = setDesktopExecutionGrant(f.device.id, 1, { version: 1, grantId: randomUUID(), localApprovalId: randomUUID(), expiresAt: Date.now() + 120000, toolRevisions: { [REMOTE_BROWSER_DESCRIPTOR.name]: f.scope.toolRevision } });
  expect(recordDesktopExecutionStop(f.signed())).toMatchObject({ revokedCurrent: false });
  expect(getDesktopExecutionGrant(f.device.id)).toMatchObject({ active: true, revision: next.revision, grant: { grantId: next.grant!.grantId } });
  revokeDevice(f.device.id);
  expect(recordDesktopExecutionStop(f.signed())).toMatchObject({ stopped: true }); expect(getDevice(f.device.id)?.revokedAt).toBeDefined();
  expect(getDesktopExecutionGrant(f.device.id)).toBeUndefined(); expect(hasVerifiedDesktopExecutionStop(f.scope)).toBe(true);
});
it('rejects other keys, changed identity/revision, approval reuse and conflicting stop receipts', () => {
  const f = fixture(), other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  expect(() => recordDesktopExecutionStop(f.signed(f.receipt, other.privateKey))).toThrow('INVALID');
  for (const patch of [{ gatewayId: randomUUID() }, { deviceId: randomUUID() }, { grantId: randomUUID() }, { authorizationRevision: 2 }]) expect(() => recordDesktopExecutionStop(f.signed({ ...f.receipt, ...patch }))).toThrow('INVALID');
  expect(getDesktopExecutionGrant(f.device.id)?.active).toBe(true);
  recordDesktopExecutionStop(f.signed());
  expect(() => recordDesktopExecutionStop(f.signed({ ...f.receipt, stopId: randomUUID() }))).toThrow('CONFLICT');
  expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM desktop_execution_stops').get()?.n).toBe(1);
});
it('does not resolve or replay unknown business operations when stop metadata releases a stale session', async () => {
  const f = fixture(); let executions = 0;
  const run = (key: string) => executeExternalOperation({ principalId: f.device.id, capabilityId: 'browser-stop-fixture', idempotencyKey: key,
    requestDigest: 'a'.repeat(64), descriptorDigest: f.scope.toolRevision, surface: 'fixture', recovery: 'manual' }, operationId => {
    recordDesktopOperationIntent({ operationId, gatewayId: f.scope.gatewayId, deviceId: f.device.id, tool: f.scope.tool, toolRevision: f.scope.toolRevision,
      argumentHash: 'a'.repeat(64), authorizationRevision: f.scope.authorizationRevision, expiresAt: Date.now() + 30000 }, f.grantId);
    executions++;
    throw new Error('Lost fixture completion');
  });
  await expect(run('original')).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  recordDesktopExecutionStop(f.signed()); expect(hasVerifiedDesktopExecutionStop(f.scope)).toBe(true);
  expect(listDesktopOperationsForReview(f.device.id, f.scope.gatewayId)).toHaveLength(1);
  await expect(run('original')).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  await expect(run('new-intent')).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' }); expect(executions).toBe(1);
  expect(getSqliteDatabase().prepare("SELECT state FROM capability_operations WHERE principal_id=?").get(f.device.id)?.state).toBe('unknown');
});
