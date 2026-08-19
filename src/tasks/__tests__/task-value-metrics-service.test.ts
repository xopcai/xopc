import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  completeExecutionReceipt,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  startExecutionReceipt,
  updateExecutionReceipt,
} from '../../storage/sqlite/index.js';
import { TaskExecutionService } from '../task-execution-service.js';
import { TaskProjectionService } from '../task-projection-service.js';
import { TaskValueMetricsService } from '../task-value-metrics-service.js';

describe('TaskValueMetricsService', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-work-value-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord('session-metrics', stateDir);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('counts one verified task rather than every execution attempt', () => {
    const execution = new TaskExecutionService().create({
      objective: 'Ship the verified result',
      acceptanceCriteria: ['The result passes verification.'],
    });
    for (const runId of ['attempt-1', 'attempt-2']) {
      startExecutionReceipt({
        runId,
        sessionKey: 'session-metrics',
        channel: 'webchat',
        objective: 'Ship the verified result',
        context: {
          taskId: execution.taskId,
          origin: 'task',
        },
      });
      updateExecutionReceipt({
        runId,
        contract: {
          objective: 'Ship the verified result',
          expectedOutputs: ['Ship the verified result'],
          acceptanceCriteria: ['The result passes verification.'],
          constraints: [],
          approvalRequired: [],
          assumptions: [],
          risks: [],
        },
        evidence: [{
          kind: 'test',
          title: 'Verification passed',
          summary: 'Independent verification completed successfully.',
          verifies: ['The result passes verification.'],
          provenance: 'tool',
          strength: 'verified',
          observedAt: Date.now(),
        }],
      });
      const receipt = completeExecutionReceipt({
        runId,
        status: 'succeeded',
        summary: 'Verified result delivered.',
      });
      if (receipt) new TaskProjectionService().project(receipt);
    }

    const metrics = new TaskValueMetricsService().get();

    expect(metrics.tasks.total).toBe(1);
    expect(metrics.tasks.achieved).toBe(1);
    expect(metrics.tasks.trusted).toBe(1);
    expect(metrics.northStar.weeklyTrustedProgress).toBe(1);
  });
});
