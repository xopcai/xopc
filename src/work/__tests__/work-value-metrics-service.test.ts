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
import { OutcomeExecutionService } from '../outcome-execution-service.js';
import { OutcomeProjectionService } from '../outcome-projection-service.js';
import { WorkValueMetricsService } from '../work-value-metrics-service.js';

describe('WorkValueMetricsService', () => {
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

  it('counts one verified outcome rather than every execution attempt', () => {
    const execution = new OutcomeExecutionService().create({
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
          outcomeId: execution.outcomeId,
          origin: 'outcome',
        },
      });
      updateExecutionReceipt({
        runId,
        contract: {
          objective: 'Ship the verified result',
          deliverables: ['Ship the verified result'],
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
      if (receipt) new OutcomeProjectionService().project(receipt);
    }

    const metrics = new WorkValueMetricsService().get();

    expect(metrics.outcomes.total).toBe(1);
    expect(metrics.outcomes.achieved).toBe(1);
    expect(metrics.outcomes.trusted).toBe(1);
    expect(metrics.northStar.weeklyTrustedProgress).toBe(1);
  });
});
