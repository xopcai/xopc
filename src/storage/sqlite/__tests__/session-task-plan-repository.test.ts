import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  ensureSessionRecord,
  getSessionTaskPlan,
  openXopcDatabase,
  resetSessionRecord,
  resetXopcDatabaseSingletonForTest,
  setSessionTaskPlan,
} from '../index.js';

const CONVERSATION_ID = "aabf5ef6-72f6-4d10-8127-43ae78e9449e";
const CWD = '/tmp/workspace';

describe('session task plan repository', () => {
  let stateDir: string;
  let databasePath: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-plan-'));
    databasePath = join(stateDir, 'xopc.db');
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: databasePath });
    ensureSessionRecord(CONVERSATION_ID, CWD, { agentId: "main" });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('persists the current todo snapshot across database reopen', () => {
    const first = setSessionTaskPlan({
      conversationId: CONVERSATION_ID,
      items: [
        { id: 'inspect', content: 'Inspect', status: 'completed' },
        { id: 'ship', content: 'Ship', status: 'in_progress' },
      ],
      now: 100,
    });
    expect(first).toMatchObject({ revision: 1, updatedAt: 100 });

    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: databasePath });

    expect(getSessionTaskPlan(CONVERSATION_ID)).toMatchObject({
      revision: 1,
      items: [
        { id: 'inspect', content: 'Inspect', status: 'completed' },
        { id: 'ship', content: 'Ship', status: 'in_progress' },
      ],
    });
  });

  it('increments revisions and starts empty after session reset', () => {
    setSessionTaskPlan({
      conversationId: CONVERSATION_ID,
      items: [{ id: 'one', content: 'One', status: 'pending' }],
    });
    expect(setSessionTaskPlan({
      conversationId: CONVERSATION_ID,
      items: [{ id: 'one', content: 'One', status: 'in_progress' }],
    })?.revision).toBe(2);

    resetSessionRecord(CONVERSATION_ID, CWD);
    expect(getSessionTaskPlan(CONVERSATION_ID)).toBeUndefined();
  });

  it('removes the active projection when every item is terminal', () => {
    setSessionTaskPlan({
      conversationId: CONVERSATION_ID,
      items: [{ id: 'one', content: 'One', status: 'in_progress' }],
    });

    expect(setSessionTaskPlan({
      conversationId: CONVERSATION_ID,
      items: [{ id: 'one', content: 'One', status: 'completed' }],
    })).toBeUndefined();
    expect(getSessionTaskPlan(CONVERSATION_ID)).toBeUndefined();
  });
});
