import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeXopcDatabase,
  completeExecutionReceipt,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  startExecutionReceipt,
  updateExecutionReceipt,
} from '../../storage/sqlite/index.js';
import { OutcomeController } from '../outcome-controller.js';
import { OutcomeExecutionService } from '../outcome-execution-service.js';
import { OutcomeProjectionService } from '../outcome-projection-service.js';
import { OutcomeRepository } from '../outcome-repository.js';

describe('OutcomeController', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-outcome-controller-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord('session-controller', stateDir);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('automatically queues the next attempt after a partial verified run', () => {
    const execution = new OutcomeExecutionService().create({
      objective: 'Deliver a verified result',
      acceptanceCriteria: ['The result is verified.'],
    });
    startExecutionReceipt({
      runId: 'partial-run',
      sessionKey: 'session-controller',
      channel: 'webchat',
      objective: 'Deliver a verified result',
      context: { outcomeId: execution.outcomeId, origin: 'outcome' },
    });
    updateExecutionReceipt({
      runId: 'partial-run',
      contract: {
        objective: 'Deliver a verified result',
        deliverables: ['Verified result'],
        acceptanceCriteria: ['The result is verified.'],
        constraints: [],
        approvalRequired: [],
        assumptions: [],
        risks: [],
      },
    });
    const receipt = new OutcomeProjectionService().project(completeExecutionReceipt({
      runId: 'partial-run',
      status: 'succeeded',
      summary: 'Work remains.',
    })!);
    const enqueue = vi.fn(() => ({
      id: 'queue-1',
      outcomeId: execution.outcomeId,
      status: 'queued' as const,
      attempts: 0,
      maxRetries: 2,
      enqueuedAt: Date.now(),
      source: 'system' as const,
    }));

    const queued = new OutcomeController({ enqueue }).handleCompletedRun(receipt);

    expect(queued?.id).toBe('queue-1');
    expect(enqueue).toHaveBeenCalledWith(execution.outcomeId, expect.objectContaining({
      source: 'system',
      executionContext: expect.objectContaining({
        parentRunId: 'partial-run',
        triggerKind: 'retry',
        strategy: 'close_verification_gaps',
      }),
      userTurn: expect.objectContaining({
        text: expect.stringContaining('The result is verified.'),
      }),
    }));
    expect(new OutcomeRepository().get(execution.outcomeId)).toMatchObject({
      userStatus: 'running',
      internalStatus: 'continuing',
    });
  });

  it('does not queue work after the outcome is achieved', () => {
    const execution = new OutcomeExecutionService().create({
      objective: 'Deliver a verified result',
      acceptanceCriteria: ['The result is verified.'],
    });
    startExecutionReceipt({
      runId: 'achieved-run',
      sessionKey: 'session-controller',
      channel: 'webchat',
      objective: 'Deliver a verified result',
      context: { outcomeId: execution.outcomeId, origin: 'outcome' },
    });
    updateExecutionReceipt({
      runId: 'achieved-run',
      contract: {
        objective: 'Deliver a verified result',
        deliverables: ['Verified result'],
        acceptanceCriteria: ['The result is verified.'],
        constraints: [],
        approvalRequired: [],
        assumptions: [],
        risks: [],
      },
      evidence: [{
        kind: 'state',
        title: 'Independent verification',
        summary: 'Verified.',
        verifies: ['The result is verified.'],
        provenance: 'judge',
        strength: 'verified',
        observedAt: Date.now(),
      }],
    });
    const receipt = new OutcomeProjectionService().project(completeExecutionReceipt({
      runId: 'achieved-run',
      status: 'succeeded',
      summary: 'Done.',
    })!);
    const enqueue = vi.fn();

    expect(new OutcomeController({ enqueue }).handleCompletedRun(receipt)).toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
