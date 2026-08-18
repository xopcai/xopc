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
  completeExecutionReceipt,
  findExecutionReceiptForAssistant,
  setExecutionReceiptFeedback,
  startExecutionReceipt,
  summarizeExecutionReceipts,
  updateExecutionReceipt,
} from '../execution-receipt-repository.js';

describe('execution receipt repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-execution-receipt-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord('agent:main:webchat:execution-receipt', stateDir);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('records one task lifecycle, evidence, and user feedback', () => {
    const sessionKey = 'agent:main:webchat:execution-receipt';
    const started = startExecutionReceipt({
      runId: 'run-1',
      sessionKey,
      channel: 'webchat',
      objective: 'Create the report',
      now: 1_000,
    });
    expect(started.status).toBe('running');

    updateExecutionReceipt({
      runId: 'run-1',
      contract: {
        objective: 'Create the report',
        deliverables: ['report.md'],
        acceptanceCriteria: ['The report opens'],
        constraints: [],
        approvalRequired: [],
        assumptions: [],
        risks: [],
      },
      evidence: [{
        kind: 'artifact',
        title: 'Report',
        summary: 'Created report.md',
        verifies: ['The report opens'],
        provenance: 'tool',
        strength: 'verified',
        observedAt: 1_500,
      }],
      judgment: {
        recommendation: 'Ship the report',
        reasons: ['The required artifact exists and is verified'],
        rejectedAlternatives: [{ option: 'Keep editing', reason: 'No acceptance criterion remains' }],
        uncertainty: 'External readers have not reviewed it yet',
        confidence: 0.9,
      },
      now: 1_500,
    });
    completeExecutionReceipt({ runId: 'run-1', status: 'succeeded', summary: 'Done', now: 2_000 });

    const matched = findExecutionReceiptForAssistant(sessionKey, 2_100);
    expect(matched?.runId).toBe('run-1');
    expect(matched?.evidence).toHaveLength(1);
    expect(matched?.verification.status).toBe('passed');
    expect(matched?.completionVerdict).toBe('achieved');
    expect(matched?.judgment).toEqual({
      recommendation: 'Ship the report',
      reasons: ['The required artifact exists and is verified'],
      rejectedAlternatives: [{ option: 'Keep editing', reason: 'No acceptance criterion remains' }],
      uncertainty: 'External readers have not reviewed it yet',
      confidence: 0.9,
    });

    const rated = setExecutionReceiptFeedback({
      sessionKey,
      assistantTimestamp: 2_100,
      outcome: 'helpful',
      supportFit: true,
      now: 2_200,
    });
    expect(rated?.feedback).toEqual({ outcome: 'helpful', supportFit: true });
    expect(summarizeExecutionReceipts()).toMatchObject({
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
    startExecutionReceipt({
      runId: 'run-unverified',
      sessionKey: 'agent:main:webchat:execution-receipt',
      channel: 'webchat',
      objective: 'Ship safely',
      now: 3_000,
    });
    updateExecutionReceipt({
      runId: 'run-unverified',
      contract: {
        objective: 'Ship safely',
        deliverables: [],
        acceptanceCriteria: ['Regression tests pass'],
        constraints: [],
        approvalRequired: [],
        assumptions: [],
        risks: [],
      },
      evidence: [{
        kind: 'state',
        title: 'Files changed',
        summary: 'Patch applied',
        provenance: 'tool',
        strength: 'observed',
        observedAt: 3_100,
      }],
      now: 3_100,
    });
    const result = completeExecutionReceipt({ runId: 'run-unverified', status: 'succeeded', summary: 'Done', now: 3_200 });
    expect(result?.verification).toMatchObject({ status: 'unverified' });
    expect(result?.completionVerdict).toBe('partial');
  });

  it('classifies failures and recommends a changed recovery strategy', () => {
    startExecutionReceipt({
      runId: 'run-failed',
      sessionKey: 'agent:main:webchat:execution-receipt',
      channel: 'webchat',
      objective: 'Run checks',
      now: 4_000,
    });
    const result = completeExecutionReceipt({
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
    expect(result?.completionVerdict).toBe('not_achieved');
  });
});
