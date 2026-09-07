import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import {
  createUnderstandingSourceRun,
  listUnderstandingSourceGrants,
  listUnderstandingSourceRuns,
  revokeUnderstandingSourceGrant,
  upsertUnderstandingSourceGrant,
  updateUnderstandingSourceGrantPolicies,
  updateUnderstandingSourceRun,
} from '../repository.js';

describe('understanding source repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-understanding-sources-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('owns grants, collection runs, and checkpoints in the unified model', () => {
    const grant = upsertUnderstandingSourceGrant({
      sourceKey: 'local:linux-recent-documents',
      adapterId: 'linux-recent-documents',
      category: 'recent_documents',
      platform: 'linux',
      displayName: 'Recent documents',
      accessMode: 'once',
      retentionPolicy: 'metadata_only',
      processingPolicy: 'local_only',
      config: { readOnly: true },
      checkpoint: { cursor: 'a' },
      nowMs: 10,
    });
    const run = createUnderstandingSourceRun({ grantId: grant.id, kind: 'bootstrap', nowMs: 11 });
    updateUnderstandingSourceRun(run.id, { status: 'completed', itemsSeen: 8, cursorAfter: 'b', completed: true, nowMs: 12 });

    expect(listUnderstandingSourceGrants()).toEqual([expect.objectContaining({ id: grant.id, checkpoint: { cursor: 'a' } })]);
    expect(listUnderstandingSourceRuns(grant.id)).toEqual([
      expect.objectContaining({ id: run.id, status: 'completed', itemsSeen: 8, cursorAfter: 'b', completedAt: 12 }),
    ]);
    expect(upsertUnderstandingSourceGrant({
      sourceKey: grant.sourceKey, adapterId: grant.adapterId, category: grant.category, platform: grant.platform,
      displayName: grant.displayName, accessMode: 'continuous', retentionPolicy: 'bounded_raw',
      processingPolicy: 'remote_allowed', config: {}, nowMs: 12,
    })).toMatchObject({
      accessMode: 'once', retentionPolicy: 'metadata_only', processingPolicy: 'local_only',
    });
    expect(revokeUnderstandingSourceGrant(grant.id, 13)).toMatchObject({ status: 'revoked' });
    expect(listUnderstandingSourceGrants()).toEqual([]);
  });

  it('updates source privacy policies only through the explicit policy operation', () => {
    const grant = upsertUnderstandingSourceGrant({
      sourceKey: 'local:policy', adapterId: 'local-work-folders', category: 'files', platform: 'all',
      displayName: 'Local policy', accessMode: 'continuous', retentionPolicy: 'metadata_only',
      processingPolicy: 'local_only', config: {}, nowMs: 10,
    });
    expect(updateUnderstandingSourceGrantPolicies(grant.id, {
      retentionPolicy: 'derived_only', processingPolicy: 'remote_allowed', nowMs: 11,
    })).toMatchObject({ retentionPolicy: 'derived_only', processingPolicy: 'remote_allowed', updatedAt: 11 });
  });

});
