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
import { OutcomeExecutionService } from '../outcome-execution-service.js';
import { OutcomeRepository } from '../outcome-repository.js';
import { OutcomeRunCoordinator } from '../outcome-run-coordinator.js';

describe('OutcomeRunCoordinator', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-outcome-run-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('accepts only criteria completed by the independent outcome judge', () => {
    const sessionKey = 'agent:main:webchat:default:direct:outcome-run';
    ensureSessionRecord(sessionKey, stateDir);
    const criterion = 'The regression suite passes.';
    const execution = new OutcomeExecutionService().create({
      objective: 'Ship a verified change',
      agentId: 'main',
      source: 'api',
      acceptanceCriteria: [criterion],
    });
    const outcomeId = execution.outcomeId;
    const coordinator = OutcomeRunCoordinator.start({
      runId: 'run-1',
      fallbackObjective: 'Ship a verified change',
      context: {
        runId: 'run-1',
        sessionKey,
        channel: 'webchat',
        outcomeId,
        origin: 'outcome',
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
    expect(new OutcomeRepository().get(outcomeId)).toMatchObject({
      userStatus: 'completed',
      internalStatus: 'completed',
    });
  });

  it('numbers continuation attempts without relying on token limits', () => {
    const sessionKey = 'agent:main:webchat:default:direct:continuation-run';
    ensureSessionRecord(sessionKey, stateDir);
    const outcome = new OutcomeRepository().create({
      objective: 'Continue until verified',
      deliverables: ['Verified result'],
      acceptanceCriteria: ['The result is independently verified.'],
    });
    const context = {
      runId: 'ignored',
      sessionKey,
      channel: 'webchat',
      outcomeId: outcome.id,
      origin: 'outcome' as const,
      triggerKind: 'user' as const,
    };
    const first = OutcomeRunCoordinator.start({ runId: 'attempt-1', context, fallbackObjective: outcome.objective });
    expect(first.finalize({ status: 'succeeded', summary: 'More work remains.' })).toMatchObject({
      attempt: 1,
      strategy: 'primary',
      completionVerdict: 'partial',
    });
    const second = OutcomeRunCoordinator.start({ runId: 'attempt-2', context, fallbackObjective: outcome.objective });
    expect(second.finalize({ status: 'succeeded', summary: 'Continuing.' })).toMatchObject({
      attempt: 2,
      strategy: 'continuation_2',
    });
  });
});
