import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../connection.js';
import { ensureSessionRecord } from '../session-repository.js';
import { getInteractionState, updateInteractionStateFromMessage } from '../interaction-state-repository.js';

describe('interaction state repository', () => {
  let stateDir: string;
  const conversationId = "7b86e8df-5a76-4773-8831-c03bfeb48f0c";

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-interaction-state-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord(conversationId, stateDir, { agentId: "main" });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('keeps a rupture active until the user explicitly signals repair', () => {
    const rupture = updateInteractionStateFromMessage({
      conversationId,
      message: '你根本没理解我，别再给建议了',
      now: 1_000,
    });
    expect(rupture).toMatchObject({ supportNeed: 'listen', repairStatus: 'needed', source: 'explicit' });

    const continued = updateInteractionStateFromMessage({ conversationId, message: '我今天很累', now: 2_000 });
    expect(continued.repairStatus).toBe('needed');

    const repaired = updateInteractionStateFromMessage({ conversationId, message: '这样好多了，谢谢调整', now: 3_000 });
    expect(repaired.repairStatus).toBe('repaired');
    expect(getInteractionState(conversationId, repaired.expiresAt)).toBeUndefined();
  });
});
