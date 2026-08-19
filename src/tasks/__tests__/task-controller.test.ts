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
  decideTaskRecovery,
  decideProactiveContinuation,
  countConsecutiveNoGain,
  TaskController,
} from '../task-controller.js';
import { TaskExecutionService } from '../task-execution-service.js';
import { TaskProjectionService } from '../task-projection-service.js';
import { TaskRepository } from '../task-repository.js';

describe('TaskController', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-controller-'));
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
    const execution = new TaskExecutionService().create({
      objective: 'Deliver a verified result',
      acceptanceCriteria: ['The result is verified.'],
    });
    startExecutionReceipt({
      runId: 'partial-run',
      sessionKey: 'session-controller',
      channel: 'webchat',
      objective: 'Deliver a verified result',
      context: { taskId: execution.taskId, origin: 'task' },
    });
    updateExecutionReceipt({
      runId: 'partial-run',
      contract: {
        objective: 'Deliver a verified result',
        expectedOutputs: ['Verified result'],
        acceptanceCriteria: ['The result is verified.'],
        constraints: [],
        approvalRequired: [],
        assumptions: [],
        risks: [],
      },
    });
    const receipt = new TaskProjectionService().project(completeExecutionReceipt({
      runId: 'partial-run',
      status: 'succeeded',
      summary: 'Work remains.',
    })!);
    const enqueue = vi.fn(() => ({
      id: 'queue-1',
      taskId: execution.taskId,
      status: 'queued' as const,
      attempts: 0,
      maxRetries: 2,
      enqueuedAt: Date.now(),
      source: 'system' as const,
    }));

    const queued = new TaskController({ enqueue }).handleCompletedRun(receipt);

    expect(queued?.id).toBe('queue-1');
    expect(enqueue).toHaveBeenCalledWith(execution.taskId, expect.objectContaining({
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
    expect(new TaskRepository().get(execution.taskId)).toMatchObject({
      status: 'running',
    });
  });

  it('does not queue work after the task is achieved', () => {
    const execution = new TaskExecutionService().create({
      objective: 'Deliver a verified result',
      acceptanceCriteria: ['The result is verified.'],
    });
    startExecutionReceipt({
      runId: 'achieved-run',
      sessionKey: 'session-controller',
      channel: 'webchat',
      objective: 'Deliver a verified result',
      context: { taskId: execution.taskId, origin: 'task' },
    });
    updateExecutionReceipt({
      runId: 'achieved-run',
      contract: {
        objective: 'Deliver a verified result',
        expectedOutputs: ['Verified result'],
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
    const receipt = new TaskProjectionService().project(completeExecutionReceipt({
      runId: 'achieved-run',
      status: 'succeeded',
      summary: 'Done.',
    })!);
    const enqueue = vi.fn();

    expect(new TaskController({ enqueue }).handleCompletedRun(receipt)).toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('asks the user instead of retrying an approval failure', () => {
    const execution = new TaskExecutionService().create({
      objective: 'Publish the release',
      acceptanceCriteria: ['Production reports the new version.'],
    });
    startExecutionReceipt({
      runId: 'approval-run',
      sessionKey: 'session-controller',
      channel: 'webchat',
      objective: 'Publish the release',
      context: { taskId: execution.taskId, origin: 'task' },
    });
    const receipt = new TaskProjectionService().project(completeExecutionReceipt({
      runId: 'approval-run',
      status: 'failed',
      summary: 'Production permission approval is required.',
    })!);
    const enqueue = vi.fn();

    expect(new TaskController({ enqueue }).handleCompletedRun(receipt)).toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
    expect(new TaskRepository().get(execution.taskId)).toMatchObject({
      status: 'needs_user',
    });
  });

  it('treats user correction as the authoritative recovery strategy', () => {
    const recovery = decideTaskRecovery({
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
    }, 3);

    expect(recovery).toEqual({ action: 'continue', strategy: 'apply_user_correction' });
  });

  it('schedules transient external failures instead of treating them as immediate retries', () => {
    const recovery = decideTaskRecovery({
      runId: 'timeout-run',
      sessionKey: 'session-controller',
      channel: 'webchat',
      objective: 'Wait for an external result',
      status: 'failed',
      attempt: 2,
      evidence: [],
      verification: { status: 'failed', checks: [] },
      failure: {
        code: 'timeout',
        phase: 'execution',
        recoveryAction: 'retry_with_changed_strategy',
      },
      context: {},
      needsUser: false,
      completionVerdict: 'not_achieved',
      projectionVersion: 0,
      startedAt: 1,
      updatedAt: 2,
    }, 0);

    expect(recovery).toEqual({ action: 'schedule', strategy: 'recheck_timeout', delayMs: 10 * 60_000 });
  });

  it('changes strategy before asking the user after repeated zero-gain runs', () => {
    const receipt = (runId: string, attempt: number) => ({
      runId,
      sessionKey: 'session-controller',
      channel: 'webchat',
      objective: 'Prepare the report',
      status: 'succeeded' as const,
      attempt,
      evidence: [],
      verification: {
        status: 'failed' as const,
        checks: [{ criterion: 'The report is verified', status: 'unverified' as const, evidenceTitles: [] }],
      },
      context: {},
      needsUser: false,
      completionVerdict: 'partial' as const,
      projectionVersion: 0,
      startedAt: attempt,
      updatedAt: attempt,
    });
    const recent = [receipt('run-4', 4), receipt('run-3', 3), receipt('run-2', 2), receipt('run-1', 1)];

    expect(countConsecutiveNoGain(recent)).toBe(3);
    expect(decideTaskRecovery(recent[0]!, 1)).toEqual({ action: 'continue', strategy: 'strategy_reset' });
    expect(decideTaskRecovery(recent[0]!, 2)).toEqual({ action: 'continue', strategy: 'independent_research' });
    expect(decideTaskRecovery(recent[0]!, 3)).toMatchObject({ action: 'needs_user' });
  });

  it('reopens corrected work and requires fresh evidence', () => {
    const execution = new TaskExecutionService().create({
      objective: 'Prepare the report',
      acceptanceCriteria: ['The chart uses signed numbers.'],
    });
    startExecutionReceipt({
      runId: 'corrected-result-run',
      sessionKey: 'session-controller',
      channel: 'webchat',
      objective: 'Prepare the report',
      context: { taskId: execution.taskId, origin: 'task' },
    });
    completeExecutionReceipt({
      runId: 'corrected-result-run',
      status: 'succeeded',
      summary: 'Report prepared.',
    });
    const corrected = new TaskProjectionService().project(setExecutionVerdict({
      runId: 'corrected-result-run',
      verdict: 'not_achieved',
      correctionText: 'Use the signed numbers and regenerate the chart.',
    })!);
    const enqueue = vi.fn(() => ({
      id: 'queue-correction',
      taskId: execution.taskId,
      status: 'queued' as const,
      attempts: 0,
      maxRetries: 2,
      enqueuedAt: Date.now(),
      source: 'system' as const,
    }));

    new TaskController({ enqueue }).handleCompletedRun(corrected);

    expect(enqueue).toHaveBeenCalledWith(execution.taskId, expect.objectContaining({
      executionContext: expect.objectContaining({ strategy: 'apply_user_correction' }),
      userTurn: expect.objectContaining({
        text: expect.stringContaining('discard any evidence invalidated by the correction'),
      }),
    }));
  });

  it('auto-continues only authorized, reversible work in the same task', () => {
    expect(decideProactiveContinuation({
      scopeRelation: 'same_task',
      reversible: true,
      authorized: true,
      confidence: 0.8,
    })).toEqual({ action: 'auto_continue' });
    expect(decideProactiveContinuation({
      scopeRelation: 'new_task',
      reversible: true,
      authorized: true,
      confidence: 0.95,
    })).toMatchObject({ action: 'ask' });
    expect(decideProactiveContinuation({
      scopeRelation: 'same_task',
      reversible: true,
      authorized: false,
      confidence: 0.95,
    })).toMatchObject({ action: 'ask' });
  });
});
