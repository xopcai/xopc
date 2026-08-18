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
  setExecutionVerdict,
  startExecutionReceipt,
  updateExecutionReceipt,
} from '../../storage/sqlite/index.js';
import {
  decideOutcomeRecovery,
  decideProactiveContinuation,
  OutcomeController,
} from '../outcome-controller.js';
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

  it('asks the user instead of retrying an approval failure', () => {
    const execution = new OutcomeExecutionService().create({
      objective: 'Publish the release',
      acceptanceCriteria: ['Production reports the new version.'],
    });
    startExecutionReceipt({
      runId: 'approval-run',
      sessionKey: 'session-controller',
      channel: 'webchat',
      objective: 'Publish the release',
      context: { outcomeId: execution.outcomeId, origin: 'outcome' },
    });
    const receipt = new OutcomeProjectionService().project(completeExecutionReceipt({
      runId: 'approval-run',
      status: 'failed',
      summary: 'Production permission approval is required.',
    })!);
    const enqueue = vi.fn();

    expect(new OutcomeController({ enqueue }).handleCompletedRun(receipt)).toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
    expect(new OutcomeRepository().get(execution.outcomeId)).toMatchObject({
      userStatus: 'needs_user',
      internalStatus: 'needs_user',
    });
  });

  it('treats user correction as the authoritative recovery strategy', () => {
    const recovery = decideOutcomeRecovery({
      runId: 'corrected-run',
      sessionKey: 'session-controller',
      channel: 'webchat',
      objective: 'Prepare the report',
      status: 'succeeded',
      attempt: 4,
      evidence: [],
      verification: { status: 'failed', checks: [] },
      context: {},
      needsUser: false,
      completionVerdict: 'not_achieved',
      correctionText: 'Use the signed numbers and regenerate the chart.',
      projectionVersion: 0,
      startedAt: 1,
      updatedAt: 2,
    }, true);

    expect(recovery).toEqual({ action: 'continue', strategy: 'apply_user_correction' });
  });

  it('reopens corrected work and requires fresh evidence', () => {
    const execution = new OutcomeExecutionService().create({
      objective: 'Prepare the report',
      acceptanceCriteria: ['The chart uses signed numbers.'],
    });
    startExecutionReceipt({
      runId: 'corrected-result-run',
      sessionKey: 'session-controller',
      channel: 'webchat',
      objective: 'Prepare the report',
      context: { outcomeId: execution.outcomeId, origin: 'outcome' },
    });
    completeExecutionReceipt({
      runId: 'corrected-result-run',
      status: 'succeeded',
      summary: 'Report prepared.',
    });
    const corrected = new OutcomeProjectionService().project(setExecutionVerdict({
      runId: 'corrected-result-run',
      verdict: 'not_achieved',
      correctionText: 'Use the signed numbers and regenerate the chart.',
    })!);
    const enqueue = vi.fn(() => ({
      id: 'queue-correction',
      outcomeId: execution.outcomeId,
      status: 'queued' as const,
      attempts: 0,
      maxRetries: 2,
      enqueuedAt: Date.now(),
      source: 'system' as const,
    }));

    new OutcomeController({ enqueue }).handleCompletedRun(corrected);

    expect(enqueue).toHaveBeenCalledWith(execution.outcomeId, expect.objectContaining({
      executionContext: expect.objectContaining({ strategy: 'apply_user_correction' }),
      userTurn: expect.objectContaining({
        text: expect.stringContaining('discard any evidence invalidated by the correction'),
      }),
    }));
  });

  it('auto-continues only authorized, reversible work in the same outcome', () => {
    expect(decideProactiveContinuation({
      scopeRelation: 'same_outcome',
      reversible: true,
      authorized: true,
      confidence: 0.8,
    })).toEqual({ action: 'auto_continue' });
    expect(decideProactiveContinuation({
      scopeRelation: 'new_outcome',
      reversible: true,
      authorized: true,
      confidence: 0.95,
    })).toMatchObject({ action: 'ask' });
    expect(decideProactiveContinuation({
      scopeRelation: 'same_outcome',
      reversible: true,
      authorized: false,
      confidence: 0.95,
    })).toMatchObject({ action: 'ask' });
  });
});
