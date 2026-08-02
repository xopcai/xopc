import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../connection.js';
import { ensureSessionRecord } from '../session-repository.js';
import {
  completeTaskOutcome,
  findTaskOutcomeForAssistant,
  setTaskOutcomeFeedback,
  startTaskOutcome,
  summarizeTaskOutcomes,
  updateTaskOutcome,
} from '../task-outcome-repository.js';

describe('task outcome repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-outcome-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord('agent:main:webchat:task-outcome', stateDir);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('records one task lifecycle, evidence, and user feedback', () => {
    const sessionKey = 'agent:main:webchat:task-outcome';
    const started = startTaskOutcome({
      runId: 'run-1',
      sessionKey,
      channel: 'webchat',
      objective: 'Create the report',
      now: 1_000,
    });
    expect(started.status).toBe('running');

    updateTaskOutcome({
      runId: 'run-1',
      contract: {
        objective: 'Create the report',
        deliverables: ['report.md'],
        acceptanceCriteria: ['The report opens'],
        constraints: [],
        approvalRequired: [],
      },
      evidence: [{
        kind: 'artifact',
        title: 'Report',
        summary: 'Created report.md',
        verifies: ['The report opens'],
      }],
      now: 1_500,
    });
    completeTaskOutcome({ runId: 'run-1', status: 'succeeded', summary: 'Done', now: 2_000 });

    const matched = findTaskOutcomeForAssistant(sessionKey, 2_100);
    expect(matched?.runId).toBe('run-1');
    expect(matched?.evidence).toHaveLength(1);
    expect(matched?.verification.status).toBe('passed');

    const rated = setTaskOutcomeFeedback({
      sessionKey,
      assistantTimestamp: 2_100,
      outcome: 'helpful',
      supportFit: true,
      now: 2_200,
    });
    expect(rated?.feedback).toEqual({ outcome: 'helpful', supportFit: true });
    expect(summarizeTaskOutcomes()).toMatchObject({
      total: 1,
      completed: 1,
      succeeded: 1,
      verified: 1,
      helpful: 1,
      completionRate: 1,
      successRate: 1,
      verificationRate: 1,
      helpfulRate: 1,
    });
  });

  it('never treats unrelated evidence as independent verification', () => {
    startTaskOutcome({
      runId: 'run-unverified',
      sessionKey: 'agent:main:webchat:task-outcome',
      channel: 'webchat',
      objective: 'Ship safely',
      now: 3_000,
    });
    updateTaskOutcome({
      runId: 'run-unverified',
      contract: {
        objective: 'Ship safely',
        deliverables: [],
        acceptanceCriteria: ['Regression tests pass'],
        constraints: [],
        approvalRequired: [],
      },
      evidence: [{ kind: 'state', title: 'Files changed', summary: 'Patch applied' }],
      now: 3_100,
    });
    const result = completeTaskOutcome({ runId: 'run-unverified', status: 'succeeded', summary: 'Done', now: 3_200 });
    expect(result?.verification).toMatchObject({ status: 'unverified' });
  });

  it('classifies failures and recommends a changed recovery strategy', () => {
    startTaskOutcome({
      runId: 'run-failed',
      sessionKey: 'agent:main:webchat:task-outcome',
      channel: 'webchat',
      objective: 'Run checks',
      now: 4_000,
    });
    const result = completeTaskOutcome({
      runId: 'run-failed',
      status: 'failed',
      summary: 'Typecheck failed with exit code 2',
      now: 4_100,
    });
    expect(result?.failure).toEqual({
      code: 'verification_failed',
      phase: 'verification',
      recoveryAction: 'replan',
    });
    expect(result?.verification.status).toBe('failed');
  });
});
