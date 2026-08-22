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
  listUserFocuses,
  revokeUnderstandingSourceGrant,
  setUserFocusStatus,
  upsertUnderstandingSourceGrant,
  upsertUserFocus,
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
    expect(revokeUnderstandingSourceGrant(grant.id, 13)).toMatchObject({ status: 'revoked' });
    expect(listUnderstandingSourceGrants()).toEqual([]);
  });

  it('requires an explicit status transition before a candidate focus becomes active', () => {
    const focus = upsertUserFocus({
      canonicalKey: 'focus:launch', title: 'Launch', summary: 'Ship the current release',
      horizon: 'current', status: 'candidate', confidence: 0.8, evidenceRefs: ['source://1'], nowMs: 10,
    });
    expect(listUserFocuses(['active'])).toEqual([]);
    expect(setUserFocusStatus(focus.id, 'active', 11)).toMatchObject({ status: 'active', updatedAt: 11 });
    expect(listUserFocuses(['active'])).toHaveLength(1);
  });
});
