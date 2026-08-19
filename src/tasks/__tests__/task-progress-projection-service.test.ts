import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  setSessionTaskPlan,
} from '../../storage/sqlite/index.js';
import { TaskProgressProjectionService } from '../task-progress-projection-service.js';
import { TaskRepository } from '../task-repository.js';

describe('TaskProgressProjectionService', () => {
  const sessionKey = 'agent:main:webchat:default:direct:progress';
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-progress-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord(sessionKey, stateDir);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('projects the session task plan without creating a second task model', () => {
    setSessionTaskPlan({
      sessionKey,
      now: 123,
      items: [
        { id: 'one', content: 'Understand the constraints', status: 'completed' },
        { id: 'two', content: 'Implement the result', status: 'in_progress' },
        { id: 'three', content: 'Verify the result', status: 'pending' },
      ],
    });
    const tasks = new TaskRepository();
    const task = tasks.create({ objective: 'Ship safely', activeSessionKey: sessionKey });

    expect(new TaskProgressProjectionService().project(task).progress).toEqual({
      completed: 1,
      total: 3,
      currentStep: 'Implement the result',
      items: [
        { id: 'one', title: 'Understand the constraints', status: 'completed' },
        { id: 'two', title: 'Implement the result', status: 'in_progress' },
        { id: 'three', title: 'Verify the result', status: 'pending' },
      ],
      updatedAt: 123,
    });
  });

  it('projects user attention from the task state', () => {
    const tasks = new TaskRepository();
    const task = tasks.create({ objective: 'Publish', approvalRequired: ['publish externally'] });
    const waiting = tasks.update(task.id, {
      status: 'needs_user',
      blockedReason: 'Approve external publication',
    })!;

    expect(new TaskProgressProjectionService().project(waiting).attention).toEqual({
      kind: 'approval',
      summary: 'Approve external publication',
    });
  });
});
