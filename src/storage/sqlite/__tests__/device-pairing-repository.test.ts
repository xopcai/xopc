import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  consumeDevicePairingToken,
  createDevicePairingSetup,
  getOrCreateGatewayIdentity,
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

  it('consumes a secure pairing setup exactly once', () => {
    const route = { id: 'secure-1', kind: 'custom-https' as const, url: 'https://gateway.example.com' };
    const setup = createDevicePairingSetup([route], 1_000);
    expect(consumeDevicePairingToken(setup.token, 2_000)).toEqual({
      ok: true,
      pairingId: setup.id,
      routes: [route],
    });
    expect(consumeDevicePairingToken(setup.token, 2_001)).toEqual({ ok: false, reason: 'consumed' });
  });

  it('expires pairing setups and rejects insecure empty setups', () => {
    expect(() => createDevicePairingSetup([], 1_000)).toThrow('No secure mobile route');
    const setup = createDevicePairingSetup([
      { id: 'secure-1', kind: 'custom-https', url: 'https://gateway.example.com' },
    ], 1_000);
    expect(consumeDevicePairingToken(setup.token, setup.expiresAt)).toEqual({ ok: false, reason: 'expired' });
  });
});
