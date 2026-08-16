import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  ensureSessionRecord,
  listTaskOutcomes,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  startTaskOutcome,
  updateTaskOutcome,
} from '../index.js';

describe('task outcome work context', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-outcome-context-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('persists execution linkage while allowing unrelated chat outcomes', () => {
    ensureSessionRecord('session-linked', stateDir);
    ensureSessionRecord('session-unlinked', stateDir);
    startTaskOutcome({
      runId: 'run-linked',
      sessionKey: 'session-linked',
      channel: 'webchat',
      objective: 'Ship the release',
      context: {
        projectId: 'project-1',
        goalId: 'goal-1',
        workItemId: 'work-1',
        origin: 'goal',
        triggerKind: 'user',
      },
      now: 100,
    });
    startTaskOutcome({
      runId: 'run-unlinked',
      sessionKey: 'session-unlinked',
      channel: 'webchat',
      objective: 'Answer a question',
      now: 200,
    });
    updateTaskOutcome({
      runId: 'run-linked',
      nextAction: 'Publish the release',
      needsUser: true,
      contextTraceId: 'trace-1',
      now: 300,
    });

    expect(listTaskOutcomes({ projectId: 'project-1' })).toEqual([
      expect.objectContaining({
        runId: 'run-linked',
        context: expect.objectContaining({
          projectId: 'project-1',
          goalId: 'goal-1',
          workItemId: 'work-1',
          contextTraceId: 'trace-1',
        }),
        nextAction: 'Publish the release',
        needsUser: true,
      }),
    ]);
    expect(listTaskOutcomes()).toHaveLength(2);
  });
});
