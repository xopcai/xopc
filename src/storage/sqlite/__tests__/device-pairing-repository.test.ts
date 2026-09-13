import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  createDevicePairingSetup,
  getOrCreateGatewayIdentity,
  isDevicePairingSetupActive,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../index.js';

describe('device pairing repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-device-pairing-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('keeps one stable gateway identity', () => {
    const first = getOrCreateGatewayIdentity(1_000);
    expect(getOrCreateGatewayIdentity(2_000)).toEqual(first);
    expect(first.publicKey).toContain('BEGIN PUBLIC KEY');
  });

  it('creates a short-lived device-targeted pairing setup', () => {
    const route = { id: 'secure-1', kind: 'custom-https' as const, url: 'https://gateway.example.com' };
    const setup = createDevicePairingSetup([route], 1_000, { targetKind: 'browser' });
    expect(setup).toMatchObject({ routes: [route], targetKind: 'browser' });
    expect(isDevicePairingSetupActive(setup.id, 2_000)).toBe(true);
    expect(isDevicePairingSetupActive(setup.id, setup.expiresAt)).toBe(false);
  });

  it('expires pairing setups and rejects insecure empty setups', () => {
    expect(() => createDevicePairingSetup([], 1_000, { targetKind: 'mobile' })).toThrow('No secure device route');
    const setup = createDevicePairingSetup([
      { id: 'secure-1', kind: 'custom-https', url: 'https://gateway.example.com' },
    ], 1_000, { targetKind: 'mobile' });
    expect(isDevicePairingSetupActive(setup.id, setup.expiresAt)).toBe(false);
  });
});
