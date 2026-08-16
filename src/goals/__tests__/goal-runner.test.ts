import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { OutcomeExecutionService } from '../../work/index.js';
import { GoalRunner } from '../goal-runner.js';
import { GoalService } from '../goal-service.js';

describe('GoalRunner', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-goal-runner-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('runs the first goal turn with context text and persisted attachments', async () => {
    const goals = new GoalService();
    const goal = new OutcomeExecutionService().create({
      objective: 'Ship a multimodal goal that follows the uploaded specification.',
      sessionKey: 'agent:main:webchat:default:direct:g1',
      constraints: ['Do not change unrelated features.'],
      deliverables: ['The implementation is verified against the specification.'],
      acceptanceCriteria: ['The implementation matches the spec.'],
    }).goal;
    goals.setContextMessage({
      goalId: goal.id,
      text: 'Use the uploaded spec before writing code.',
      attachments: [{
        id: 'spec.txt',
        bucket: 'inbound',
        type: 'document',
        mimeType: 'text/plain',
        name: 'spec.txt',
        size: 12,
        uri: 'media://inbound/spec.txt',
        path: '/tmp/spec.txt',
      }],
    });
    const runTurn = vi.fn(async () => {});
    const bindExecutionContext = vi.fn(async () => {});
    const runner = new GoalRunner({
      ensureSession: vi.fn(async () => goal.activeSessionKey!),
      bindExecutionContext,
      hasActiveRun: vi.fn(() => false),
      runTurn,
    });

    const queued = runner.enqueue(goal.id, {
      executionContext: {
        workItemId: 'work-item-1',
        contextTraceId: 'intake-1',
        triggerKind: 'user',
      },
    });

    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1));
    expect(runner.snapshot().find((item) => item.id === queued.id)?.executionContext).toEqual({
      workItemId: 'work-item-1',
      contextTraceId: 'intake-1',
      triggerKind: 'user',
    });
    expect(bindExecutionContext).toHaveBeenCalledWith(
      goal.activeSessionKey,
      expect.objectContaining({ id: goal.id }),
      {
        workItemId: 'work-item-1',
        contextTraceId: 'intake-1',
        triggerKind: 'user',
      },
    );
    const [sessionKey, userTurn] = runTurn.mock.calls[0]!;
    expect(sessionKey).toBe(goal.activeSessionKey);
    expect(userTurn.text).toContain('Outcome:\nShip a multimodal goal that follows the uploaded specification.');
    expect(userTurn.text).toContain('Constraints:\n- Do not change unrelated features.');
    expect(userTurn.text).toContain('Deliverables:\n- The implementation is verified against the specification.');
    expect(userTurn.text).toContain('Context:\nUse the uploaded spec before writing code.');
    expect(userTurn.text).toContain('Acceptance criteria:');
    expect(userTurn.attachments).toEqual([
      expect.objectContaining({
        type: 'document',
        mimeType: 'text/plain',
        uri: 'media://inbound/spec.txt',
        name: 'spec.txt',
      }),
    ]);
  });
});
