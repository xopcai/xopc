import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { OutcomeRepository } from '../outcome-repository.js';

describe('OutcomeRepository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-outcomes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('keeps a stable outcome while versioning contracts and linking execution objects', () => {
    const repository = new OutcomeRepository();
    const created = repository.create({
      id: 'outcome-1',
      objective: 'Ship a verified release',
      acceptanceCriteria: ['Release checks pass'],
      createdBy: 'user',
      links: [{ kind: 'goal', id: 'goal-1', relation: 'drives' }],
      now: 100,
    });

    expect(created).toMatchObject({
      id: 'outcome-1',
      userStatus: 'running',
      internalStatus: 'captured',
      latestContractVersion: 1,
      contract: { acceptanceCriteria: ['Release checks pass'] },
    });
    expect(repository.getBySubject('goal', 'goal-1')?.id).toBe('outcome-1');

    const revised = repository.reviseContract({
      outcomeId: created.id,
      objective: created.objective,
      deliverables: ['Release artifact'],
      acceptanceCriteria: ['Release checks pass', 'Artifact is published'],
      constraints: ['Do not publish without approval'],
      approvalRequired: ['Publish release'],
      createdBy: 'system',
      now: 200,
    });

    expect(revised.latestContractVersion).toBe(2);
    expect(revised.contract).toMatchObject({
      version: 2,
      deliverables: ['Release artifact'],
      approvalRequired: ['Publish release'],
    });
    expect(repository.getContract(created.id, 1)?.acceptanceCriteria).toEqual(['Release checks pass']);
  });

  it('projects internal execution state to the three user-visible states', () => {
    const repository = new OutcomeRepository();
    repository.create({ id: 'outcome-2', objective: 'Prepare launch brief' });

    expect(repository.updateState({
      id: 'outcome-2',
      userStatus: 'needs_user',
      internalStatus: 'needs_user',
      latestReceiptRunId: 'run-1',
    })).toMatchObject({
      userStatus: 'needs_user',
      internalStatus: 'needs_user',
      latestReceiptRunId: 'run-1',
    });
  });
});
