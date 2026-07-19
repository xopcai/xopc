import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  getUserTrustPolicy,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  setUserTrustPolicy,
} from '../index.js';

describe('user trust repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-user-trust-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('defaults to confirm and persists an explicit choice', () => {
    expect(getUserTrustPolicy()).toMatchObject({
      principalId: 'local-owner',
      defaultActionLevel: 'confirm',
    });

    const saved = setUserTrustPolicy('observe');
    expect(saved).toMatchObject({
      principalId: 'local-owner',
      defaultActionLevel: 'observe',
    });
    expect(saved.updatedAt).toBeTruthy();
    expect(getUserTrustPolicy().defaultActionLevel).toBe('observe');

    expect(setUserTrustPolicy('auto').defaultActionLevel).toBe('auto');
    expect(getUserTrustPolicy().defaultActionLevel).toBe('auto');
  });
});
