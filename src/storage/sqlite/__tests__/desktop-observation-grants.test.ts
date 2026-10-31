import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../connection.js';
import { createDevice, getDevice, getDesktopStateObservation, setDesktopStateObservation } from '../device-access-repository.js';
import { getSqliteDatabase } from '../transaction.js';

let directory: string, path: string;
const publicKeyJwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'xopc-desktop-grants-')); path = join(directory, 'xopc.db'); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path }); });
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true }); });
it('persists revocation versions and rejects a late grant after a Gateway restart', () => {
  const device = createDevice({ displayName: 'Synthetic desktop', platform: 'desktop', publicKeyJwk, scopes: ['gateway.status', 'device.self'] });
  expect(getDesktopStateObservation(device.id)?.revision).toBe(0);
  expect(setDesktopStateObservation(device.id, true, 0)).toMatchObject({ revision: 1, stateEnabled: true });
  expect(setDesktopStateObservation(device.id, false)).toMatchObject({ revision: 2, stateEnabled: false });
  closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path });
  expect(() => setDesktopStateObservation(device.id, true, 0)).toThrow('DESKTOP_OBSERVATION_REVISION_CHANGED');
  expect(getDesktopStateObservation(device.id)).toMatchObject({ revision: 2, stateEnabled: false });
  expect(setDesktopStateObservation(device.id, true, 2)).toMatchObject({ revision: 3, stateEnabled: true });
});
it('rolls back the scope when persisting its grant version fails', () => {
  const device = createDevice({ displayName: 'Synthetic desktop', platform: 'desktop', publicKeyJwk, scopes: ['device.self'] });
  getSqliteDatabase().exec("CREATE TRIGGER fail_desktop_grant BEFORE INSERT ON desktop_observation_grants BEGIN SELECT RAISE(ABORT, 'Synthetic grant commit failure'); END");
  expect(() => setDesktopStateObservation(device.id, true, 0)).toThrow('Synthetic grant commit failure');
  expect(getDevice(device.id)?.scopes).toEqual(['device.self']); expect(getDesktopStateObservation(device.id)?.revision).toBe(0);
});
it('cannot assign a desktop observation grant to a mobile device', () => {
  const device = createDevice({ displayName: 'Synthetic phone', platform: 'ios', publicKeyJwk, scopes: ['device.self', 'phone.view'] });
  expect(setDesktopStateObservation(device.id, true, 0)).toBeUndefined(); expect(getDevice(device.id)?.scopes).toEqual(['device.self', 'phone.view']);
});
