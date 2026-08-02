import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../connection.js';
import { ensureSessionRecord } from '../session-repository.js';
import { getInteractionState, updateInteractionStateFromMessage } from '../interaction-state-repository.js';

describe('interaction state repository', () => {
  let stateDir: string;
  const sessionKey = 'agent:main:webchat:interaction-state';

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-interaction-state-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord(sessionKey, stateDir);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('keeps a rupture active until the user explicitly signals repair', () => {
    const rupture = updateInteractionStateFromMessage({
      sessionKey,
      message: '你根本没理解我，别再给建议了',
      now: 1_000,
    });
    expect(rupture).toMatchObject({ supportNeed: 'listen', repairStatus: 'needed', source: 'explicit' });

    const continued = updateInteractionStateFromMessage({ sessionKey, message: '我今天很累', now: 2_000 });
    expect(continued.repairStatus).toBe('needed');

    const repaired = updateInteractionStateFromMessage({ sessionKey, message: '这样好多了，谢谢调整', now: 3_000 });
    expect(repaired.repairStatus).toBe('repaired');
    expect(getInteractionState(sessionKey, repaired.expiresAt)).toBeUndefined();
  });
});
