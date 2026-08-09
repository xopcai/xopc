import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../connection.js';
import { acknowledgeHomeAttention, isHomeAttentionAcknowledged } from '../home-attention-repository.js';

describe('home attention repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-home-attention-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('persists acknowledgement per run without hiding future failures', () => {
    expect(isHomeAttentionAcknowledged('automation_run', 'run-1')).toBe(false);

    acknowledgeHomeAttention('automation_run', 'run-1', 1_000);

    expect(isHomeAttentionAcknowledged('automation_run', 'run-1')).toBe(true);
    expect(isHomeAttentionAcknowledged('automation_run', 'run-2')).toBe(false);
    expect(isHomeAttentionAcknowledged('workflow_run', 'run-1')).toBe(false);
  });
});
