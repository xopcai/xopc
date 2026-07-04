import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { onAutomationProductEvent } from '../../automations/product-events.js';
import { GoalService } from '../goal-service.js';

const SESSION_KEY = 'agent:main:webchat:default:direct:test-goal';

describe('GoalService', () => {
  let stateDir: string;
  let goals: GoalService;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-goals-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    goals = new GoalService();
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates a session-linked goal and reads it as current', () => {
    const goal = goals.create({
      title: 'Ship the goal workspace',
      sessionKey: SESSION_KEY,
      maxTurns: 12,
    });

    expect(goal.status).toBe('active');
    expect(goal.agentId).toBe('main');
    expect(goal.activeSessionKey).toBe(SESSION_KEY);

    const current = goals.getActiveForSession(SESSION_KEY);
    expect(current?.id).toBe(goal.id);
    expect(current?.title).toBe('Ship the goal workspace');
    expect(current?.checklist).toEqual([]);
  });

  it('publishes product events when goals are created and blocked', () => {
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    const unsubscribe = onAutomationProductEvent((event) => {
      events.push({ type: event.type, payload: event.payload });
    });
    try {
      const goal = goals.create({
        title: 'Investigate blocked workflow',
        sessionKey: SESSION_KEY,
      });
      goals.setStatus(goal.id, 'blocked', { reason: 'Missing credentials' });
    } finally {
      unsubscribe();
    }

    expect(events.map((event) => event.type)).toEqual(['goal.created', 'goal.status_changed']);
    expect(events[1]?.payload).toMatchObject({
      status: 'blocked',
      previousStatus: 'active',
      reason: 'Missing credentials',
    });
  });

  it('updates checklist and records a completed run', () => {
    const goal = goals.create({
      title: 'Finish release',
      sessionKey: SESSION_KEY,
      maxTurns: 3,
    });
    const withItem = goals.updateChecklist(goal.id, {
      type: 'add',
      text: 'Release notes are written',
    });
    const item = withItem?.checklist[0];
    expect(item?.status).toBe('pending');

    const marked = goals.updateChecklist(goal.id, {
      type: 'mark',
      itemId: item!.id,
      status: 'completed',
      evidenceSummary: 'release-notes.md updated',
    });
    expect(marked?.checklist[0]?.evidenceSummary).toBe('release-notes.md updated');

    const afterRun = goals.syncPostTurnState({
      goalId: goal.id,
      sessionKey: SESSION_KEY,
      source: 'chat',
      status: 'done',
      turnsUsed: 1,
      maxTurns: 3,
      verdict: 'done',
      reason: 'All release criteria are satisfied.',
      assistantPreview: 'Done.',
      checklist: marked!.checklist.map((it) => ({
        text: it.text,
        status: it.status,
        addedBy: it.addedBy,
        addedAt: it.addedAt,
        completedAt: it.completedAt,
        evidenceSummary: it.evidenceSummary,
      })),
    });

    expect(afterRun?.status).toBe('done');
    expect(afterRun?.turnsUsed).toBe(1);

    const runs = goals.listRuns(goal.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.verdict).toBe('done');
    expect(runs[0]?.reason).toContain('satisfied');
  });

  it('updates goal metadata', () => {
    const goal = goals.create({
      title: 'Draft goal',
      sessionKey: SESSION_KEY,
      maxTurns: 3,
    });

    const updated = goals.update(goal.id, {
      title: 'Ship goal runner',
      description: 'Keep the durable goal moving.',
      priority: 'high',
      deadlineAt: 1_800_000_000_000,
      maxTurns: 25,
      judgeModelRef: 'openai/gpt-5',
      nextAction: 'Run the queue',
      blockedReason: 'Waiting for approval',
    });

    expect(updated).toMatchObject({
      title: 'Ship goal runner',
      description: 'Keep the durable goal moving.',
      priority: 'high',
      deadlineAt: 1_800_000_000_000,
      maxTurns: 25,
      judgeModelRef: 'openai/gpt-5',
      nextAction: 'Run the queue',
      blockedReason: 'Waiting for approval',
    });
  });

  it('closes board status actions without stale terminal fields', () => {
    const goal = goals.create({
      title: 'Recover board actions',
      sessionKey: SESSION_KEY,
      maxTurns: 3,
    });

    const done = goals.setStatus(goal.id, 'done');
    expect(done?.status).toBe('done');
    expect(done?.completedAt).toEqual(expect.any(Number));

    const reopened = goals.reopen(goal.id);
    expect(reopened?.status).toBe('active');
    expect(reopened?.completedAt).toBeUndefined();
    expect(reopened?.archivedAt).toBeUndefined();
    expect(reopened?.blockedReason).toBeUndefined();

    const archived = goals.archive(goal.id);
    expect(archived?.status).toBe('archived');
    expect(archived?.archivedAt).toEqual(expect.any(Number));

    const unarchived = goals.unarchive(goal.id);
    expect(unarchived?.status).toBe('paused');
    expect(unarchived?.archivedAt).toBeUndefined();
    expect(unarchived?.completedAt).toBeUndefined();

    const resumed = goals.resume(goal.id);
    expect(resumed?.status).toBe('active');
    expect(resumed?.blockedReason).toBeUndefined();

    const completed = goals.complete(goal.id);
    expect(completed?.status).toBe('done');
    expect(completed?.completedAt).toEqual(expect.any(Number));
  });
});
