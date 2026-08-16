import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { OutcomeExecutionService } from '../../work/index.js';
import { GoalQueueStore } from '../goal-queue-store.js';

describe('GoalQueueStore', () => {
  let stateDir: string;
  let store: GoalQueueStore;
  let goalId: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-goal-queue-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    store = new GoalQueueStore();
    goalId = new OutcomeExecutionService().create({
      objective: 'Persist goal queue',
      sessionKey: 'agent:main:webchat:default:direct:goal-queue',
      maxTurns: 3,
    }).goal.id;
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('deduplicates active goal queue rows and claims due work', () => {
    const first = store.enqueue({
      goalId,
      userTurn: { text: 'continue' },
      maxRetries: 2,
      source: 'api',
    });
    const duplicate = store.enqueue({
      goalId,
      userTurn: { text: 'again' },
      maxRetries: 2,
      source: 'api',
    });

    expect(duplicate.id).toBe(first.id);
    expect(store.list()).toHaveLength(1);

    const claimed = store.claimNext();
    expect(claimed).toMatchObject({
      id: first.id,
      status: 'running',
      attempts: 1,
      userTurn: { text: 'continue' },
    });

    const withSession = store.setSessionKey(first.id, 'agent:main:webchat:default:direct:run');
    expect(withSession?.sessionKey).toBe('agent:main:webchat:default:direct:run');

    const nextRunAt = Date.now() + 10_000;
    const retry = store.markRetry(first.id, 'busy', nextRunAt);
    expect(retry).toMatchObject({
      status: 'retry_waiting',
      lastError: 'busy',
      nextRunAt,
    });
    expect(store.claimNext(Date.now())).toBeNull();
    expect(store.claimNext(nextRunAt)?.status).toBe('running');
  });

  it('recovers running items as retryable work after restart', () => {
    const item = store.enqueue({
      goalId,
      maxRetries: 1,
      source: 'api',
    });
    expect(store.claimNext()?.status).toBe('running');

    const changed = store.resetRunningToRetry('restart');
    expect(changed).toBe(1);

    const snapshot = store.list()[0];
    expect(snapshot).toMatchObject({
      id: item.id,
      status: 'retry_waiting',
      lastError: 'restart',
    });
  });
});
