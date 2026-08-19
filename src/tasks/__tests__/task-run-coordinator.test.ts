import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  updateExecutionReceipt,
} from '../../storage/sqlite/index.js';
import { TaskExecutionService } from '../task-execution-service.js';
import { TaskRepository } from '../task-repository.js';
import { TaskRunCoordinator } from '../task-run-coordinator.js';

describe('TaskRunCoordinator', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-run-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('accepts only criteria completed by the independent task judge', () => {
    const sessionKey = 'agent:main:webchat:default:direct:task-run';
    ensureSessionRecord(sessionKey, stateDir);
    const criterion = 'The regression suite passes.';
    const execution = new TaskExecutionService().create({
      objective: 'Ship a verified change',
      agentId: 'main',
      source: 'api',
      acceptanceCriteria: [criterion],
    });
    const taskId = execution.taskId;
    const coordinator = TaskRunCoordinator.start({
      runId: 'run-1',
      fallbackObjective: 'Ship a verified change',
      context: {
        runId: 'run-1',
        sessionKey,
        channel: 'webchat',
        taskId,
        origin: 'task',
        triggerKind: 'user',
      },
    });
    coordinator.capturePlan([{ title: criterion, status: 'completed' }]);
    updateExecutionReceipt({
      runId: 'run-1',
      evidence: [{
        kind: 'state',
        title: `Independently verified: ${criterion}`,
        summary: 'A separate judge reviewed the run transcript and test evidence.',
        verifies: [criterion],
        provenance: 'judge',
        strength: 'verified',
        observedAt: Date.now(),
      }],
    });

    const receipt = coordinator.finalize({ status: 'succeeded', summary: 'Run completed.' });

    expect(receipt).toMatchObject({
      completionVerdict: 'achieved',
      verification: { status: 'passed' },
      attempt: 1,
      strategy: 'primary',
    });
    expect(receipt?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: `Independently verified: ${criterion}`,
        verifies: [criterion],
      }),
    ]));
    expect(new TaskRepository().get(taskId)).toMatchObject({
      status: 'completed',
    });
  });

  it('numbers continuation attempts without relying on token limits', () => {
    const sessionKey = 'agent:main:webchat:default:direct:continuation-run';
    ensureSessionRecord(sessionKey, stateDir);
    const task = new TaskRepository().create({
      objective: 'Continue until verified',
      expectedOutputs: ['Verified result'],
      acceptanceCriteria: ['The result is independently verified.'],
    });
    const context = {
      runId: 'ignored',
      sessionKey,
      channel: 'webchat',
      taskId: task.id,
      origin: 'task' as const,
      triggerKind: 'user' as const,
    };
    const first = TaskRunCoordinator.start({ runId: 'attempt-1', context, fallbackObjective: task.objective });
    expect(first.finalize({ status: 'succeeded', summary: 'More work remains.' })).toMatchObject({
      attempt: 1,
      strategy: 'primary',
      completionVerdict: 'partial',
    });
    const second = TaskRunCoordinator.start({ runId: 'attempt-2', context, fallbackObjective: task.objective });
    expect(second.finalize({ status: 'succeeded', summary: 'Continuing.' })).toMatchObject({
      attempt: 2,
      strategy: 'continuation_2',
    });
  });
});
