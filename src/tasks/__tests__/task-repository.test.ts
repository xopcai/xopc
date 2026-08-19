import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { onAutomationProductEvent } from '../../automations/product-events.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { TaskRepository } from '../task-repository.js';

describe('TaskRepository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-tasks-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('keeps a stable task while versioning contracts and linking execution objects', () => {
    const repository = new TaskRepository();
    const created = repository.create({
      id: 'task-1',
      objective: 'Ship a verified release',
      acceptanceCriteria: ['Release checks pass'],
      createdBy: 'user',
      links: [{ kind: 'workflow', id: 'workflow-1', relation: 'drives' }],
      now: 100,
    });

    expect(created).toMatchObject({
      id: 'task-1',
      status: 'pending',
      latestContractVersion: 1,
      contract: { acceptanceCriteria: ['Release checks pass'] },
    });
    expect(repository.getBySubject('workflow', 'workflow-1')?.id).toBe('task-1');

    const revised = repository.reviseContract({
      taskId: created.id,
      objective: created.objective,
      expectedOutputs: ['Release artifact'],
      acceptanceCriteria: ['Release checks pass', 'Artifact is published'],
      constraints: ['Do not publish without approval'],
      approvalRequired: ['Publish release'],
      assumptions: ['Release branch is current'],
      risks: ['Registry outage'],
      createdBy: 'system',
      now: 200,
    });

    expect(revised.latestContractVersion).toBe(2);
    expect(revised.contract).toMatchObject({
      version: 2,
      expectedOutputs: ['Release artifact'],
      approvalRequired: ['Publish release'],
      assumptions: ['Release branch is current'],
      risks: ['Registry outage'],
    });
    expect(repository.getContract(created.id, 1)?.acceptanceCriteria).toEqual(['Release checks pass']);
  });

  it('stores one authoritative task status', () => {
    const repository = new TaskRepository();
    repository.create({ id: 'task-2', objective: 'Prepare launch brief' });

    expect(repository.update('task-2', {
      status: 'needs_user',
      latestReceiptRunId: 'run-1',
    })).toMatchObject({
      status: 'needs_user',
      latestReceiptRunId: 'run-1',
    });
  });

  it('publishes created and status events from the aggregate write path', () => {
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    const unsubscribe = onAutomationProductEvent((event) => { events.push(event); });
    try {
      const repository = new TaskRepository();
      repository.create({ id: 'task-events', objective: 'Resolve the blocker', agentId: 'main' });
      repository.update('task-events', {
        status: 'blocked',
        blockedReason: 'Missing production access',
      });
    } finally {
      unsubscribe();
    }

    expect(events).toEqual([
      expect.objectContaining({
        type: 'task.created',
        source: 'tasks',
        payload: expect.objectContaining({ taskId: 'task-events', status: 'pending' }),
      }),
      expect.objectContaining({
        type: 'task.status_changed',
        source: 'tasks',
        payload: expect.objectContaining({
          taskId: 'task-events',
          previousStatus: 'pending',
          status: 'blocked',
          blockedReason: 'Missing production access',
        }),
      }),
    ]);
  });
});
