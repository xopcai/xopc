import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  ensureSessionRecord,
  listExecutionReceipts,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  startExecutionReceipt,
  updateExecutionReceipt,
} from '../index.js';
import { TaskExecutionService } from '../../../tasks/task-execution-service.js';

describe('execution receipt work context', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-execution-receipt-context-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('persists execution linkage while allowing unrelated chat tasks', () => {
    ensureSessionRecord('session-linked', stateDir);
    ensureSessionRecord('session-unlinked', stateDir);
    const task = new TaskExecutionService().create({ objective: 'Ship the release' });
    startExecutionReceipt({
      runId: 'run-linked',
      sessionKey: 'session-linked',
      channel: 'webchat',
      objective: 'Ship the release',
      context: {
        projectId: 'project-1',
        taskId: task.taskId,
        origin: 'task',
        triggerKind: 'user',
      },
      now: 100,
    });
    startExecutionReceipt({
      runId: 'run-unlinked',
      sessionKey: 'session-unlinked',
      channel: 'webchat',
      objective: 'Answer a question',
      now: 200,
    });
    updateExecutionReceipt({
      runId: 'run-linked',
      nextAction: 'Publish the release',
      needsUser: true,
      contextTraceId: 'trace-1',
      now: 300,
    });

    expect(listExecutionReceipts({ projectId: 'project-1' })).toEqual([
      expect.objectContaining({
        runId: 'run-linked',
        context: expect.objectContaining({
          projectId: 'project-1',
          taskId: task.taskId,
          contextTraceId: 'trace-1',
        }),
        nextAction: 'Publish the release',
        needsUser: true,
      }),
    ]);
    expect(listExecutionReceipts()).toHaveLength(2);
  });
});
