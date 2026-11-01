import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../connection.js';
import { createDevice, getDevice, getDesktopStateObservation, revokeDevice, setDesktopStateObservation } from '../device-access-repository.js';
import { getDesktopExecutionGrant, revokeDesktopExecutionGrant, setDesktopExecutionGrant } from '../desktop-execution-repository.js';
import { getSqliteDatabase } from '../transaction.js';

let root: string, id: string;
const grant = () => ({ version: 1 as const, grantId: randomUUID(), localApprovalId: randomUUID(),
  toolRevisions: { 'desktop.clipboard.write': 'a'.repeat(64) }, expiresAt: Date.now() + 60000 });
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'xopc-execution-grant-')); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(root, 'gateway.db') });
  id = createDevice({ displayName: 'Fixture desktop', platform: 'desktop', scopes: ['gateway.status', 'device.self'],
    publicKeyJwk: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' }) }).id;
});
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(root, { recursive: true, force: true }); });

it('keeps default credentials powerless, grants exact revisions and recovers an identical lost acknowledgement without renewal', () => {
  expect(getDesktopExecutionGrant(id)).toMatchObject({ revision: 0, active: false });
  const proposal = grant(), first = setDesktopExecutionGrant(id, 0, proposal);
  expect(first).toMatchObject({ revision: 1, active: true, grant: proposal }); expect(getDevice(id)?.scopes).toContain('desktop.execute');
  expect(setDesktopExecutionGrant(id, 0, proposal)).toEqual(first);
  expect(getSqliteDatabase().prepare('SELECT count(*) AS count FROM desktop_execution_grant_events').get()?.count).toBe(1);
  expect(() => setDesktopExecutionGrant(id, 1, { ...proposal, expiresAt: proposal.expiresAt + 1 })).toThrow('APPROVAL_ALREADY_USED');
});

it('does not let a stale approval or cleanup revoke or replace a newer grant', () => {
  const first = grant(); setDesktopExecutionGrant(id, 0, first);
  const second = grant(); const current = setDesktopExecutionGrant(id, 1, second);
  expect(() => revokeDesktopExecutionGrant(id, first.grantId, 1)).toThrow('REVISION_CHANGED');
  expect(() => setDesktopExecutionGrant(id, 0, first)).toThrow('REVISION_CHANGED');
  expect(getDesktopExecutionGrant(id)).toEqual(current);
  const revoked = revokeDesktopExecutionGrant(id, second.grantId, 2); expect(revoked).toMatchObject({ active: false, revision: 3 });
  expect(revokeDesktopExecutionGrant(id, second.grantId, 2)).toEqual(revoked);
  expect(() => setDesktopExecutionGrant(id, 3, second)).toThrow('APPROVAL_ALREADY_USED');
});

it('mutually excludes observation and execution without an old observation cleanup revoking a new execution grant', () => {
  setDesktopStateObservation(id, true, 0);
  const proposal = grant(); setDesktopExecutionGrant(id, 0, proposal);
  expect(getDevice(id)?.scopes).not.toContain('desktop.observe.state');
  expect(() => setDesktopStateObservation(id, true, 1)).toThrow('OBSERVATION_REVISION_CHANGED');
  setDesktopStateObservation(id, false);
  expect(getDesktopExecutionGrant(id)?.active).toBe(true);
  const observation = getDesktopStateObservation(id)!; setDesktopStateObservation(id, true, observation.revision);
  expect(getDesktopExecutionGrant(id)).toMatchObject({ active: false, revision: 2 });
  expect(getDevice(id)?.scopes).not.toContain('desktop.execute');
});

it('never extends an expired grant and refuses unknown tools, excessive deadlines or reused native approval identities', () => {
  const proposal = grant(); setDesktopExecutionGrant(id, 0, proposal);
  expect(getDesktopExecutionGrant(id, proposal.expiresAt + 1)).toMatchObject({ enabled: true, active: false });
  expect(() => setDesktopExecutionGrant(id, 0, proposal, proposal.expiresAt + 1)).toThrow('GRANT_EXPIRED');
  const now = Date.now();
  expect(() => setDesktopExecutionGrant(id, 1, { ...grant(), expiresAt: now + 300001 }, now)).toThrow('GRANT_EXPIRED');
  expect(() => setDesktopExecutionGrant(id, 1, { ...grant(), localApprovalId: proposal.localApprovalId })).toThrow('APPROVAL_ALREADY_USED');
  expect(() => setDesktopExecutionGrant(id, 1, { ...grant(), toolRevisions: { 'desktop.shell.run': 'a'.repeat(64) } } as any)).toThrow();
});

it('rejects a revoked device and does not restore its authority from a retained grant record', () => {
  const proposal = grant(); setDesktopExecutionGrant(id, 0, proposal); revokeDevice(id);
  expect(getDesktopExecutionGrant(id)).toBeUndefined();
  expect(() => setDesktopExecutionGrant(id, 1, grant())).toThrow('DEVICE_INVALID');
});
