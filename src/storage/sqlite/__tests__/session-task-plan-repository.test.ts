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

const SESSION_KEY = 'agent:main:webchat:default:dm:todo-test';
const CWD = '/tmp/workspace';

describe('session task plan repository', () => {
  let stateDir: string;
  let databasePath: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-plan-'));
    databasePath = join(stateDir, 'xopc.db');
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: databasePath });
    ensureSessionRecord(SESSION_KEY, CWD);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('persists the current todo snapshot across database reopen', () => {
    const first = setSessionTaskPlan({
      sessionKey: SESSION_KEY,
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

    expect(getSessionTaskPlan(SESSION_KEY)).toMatchObject({
      revision: 1,
      items: [
        { id: 'inspect', content: 'Inspect', status: 'completed' },
        { id: 'ship', content: 'Ship', status: 'in_progress' },
      ],
    });
  });

  it('increments revisions and starts empty after session reset', () => {
    setSessionTaskPlan({
      sessionKey: SESSION_KEY,
      items: [{ id: 'one', content: 'One', status: 'pending' }],
    });
    expect(setSessionTaskPlan({
      sessionKey: SESSION_KEY,
      items: [{ id: 'one', content: 'One', status: 'in_progress' }],
    })?.revision).toBe(2);

    resetSessionRecord(SESSION_KEY, CWD);
    expect(getSessionTaskPlan(SESSION_KEY)).toBeUndefined();
  });

  it('removes the active projection when every item is terminal', () => {
    setSessionTaskPlan({
      sessionKey: SESSION_KEY,
      items: [{ id: 'one', content: 'One', status: 'in_progress' }],
    });

    expect(setSessionTaskPlan({
      sessionKey: SESSION_KEY,
      items: [{ id: 'one', content: 'One', status: 'completed' }],
    })).toBeUndefined();
    expect(getSessionTaskPlan(SESSION_KEY)).toBeUndefined();
  });
});
