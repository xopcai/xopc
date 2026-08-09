import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  requireXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import {
  createFocus,
  createFocusActivity,
  deleteFocus,
  getFocus,
  getFocusMonitor,
  listFocusActivities,
  listFocuses,
  updateFocus,
  updateFocusMonitorRuntime,
  upsertFocusMonitor,
} from '../repository.js';
import { acceptFocusCandidate, listFocusCandidates, upsertFocusCandidate } from '../candidate-repository.js';
import { persistWorkThreadsFromDiscovery } from '../../work-discovery/thread-service.js';

describe('focus repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-focus-repository-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates, updates, lists, and completes a focus', () => {
    const focus = createFocus({ title: 'Gateway billing', summary: 'Build quota support.', nowMs: 100 });

    expect(focus).toMatchObject({ status: 'active', source: 'user', lastActivityAt: 100 });
    expect(listFocusActivities({ focusId: focus.id })).toEqual([
      expect.objectContaining({ type: 'created', createdAt: 100 }),
    ]);

    const completed = updateFocus({ id: focus.id, status: 'completed', nowMs: 200 });
    expect(completed).toMatchObject({ status: 'completed', completedAt: 200 });
    expect(listFocuses()).toEqual([]);
    expect(listFocuses({ statuses: ['completed'] })).toHaveLength(1);
  });

  it('keeps monitor intent separate from runtime state', () => {
    const focus = createFocus({ title: 'OAuth scopes', summary: 'Review account summaries.' });
    const monitor = upsertFocusMonitor({
      focusId: focus.id,
      kind: 'external_changes',
      enabled: true,
      runState: 'queued',
      cadence: { kind: 'interval', everyMs: 86_400_000 },
    });

    expect(monitor).toMatchObject({ enabled: true, runState: 'queued' });
    const failed = updateFocusMonitorRuntime({ id: monitor.id, runState: 'failed', error: 'Timed out' });
    expect(failed).toMatchObject({ enabled: true, runState: 'failed', consecutiveFailures: 1 });

    const disabled = upsertFocusMonitor({
      focusId: focus.id,
      kind: 'external_changes',
      enabled: false,
      cadence: monitor.cadence,
    });
    expect(disabled).toMatchObject({ id: monitor.id, enabled: false, runState: 'idle' });
  });

  it('cascades all owned data when a focus is deleted', () => {
    const focus = createFocus({ title: 'Quota pool', summary: 'Implement upstream pools.' });
    const monitor = upsertFocusMonitor({
      focusId: focus.id,
      kind: 'progress',
      enabled: false,
      cadence: { kind: 'interval', everyMs: 86_400_000 },
    });
    createFocusActivity({ focusId: focus.id, monitorId: monitor.id, type: 'run_no_change', summary: 'No change' });

    expect(deleteFocus(focus.id)).toBe(true);
    expect(getFocus(focus.id)).toBeNull();
    expect(getFocusMonitor(focus.id, 'progress')).toBeNull();
    expect(requireXopcDatabase().db.prepare('SELECT COUNT(*) AS count FROM focus_activities').get())
      .toEqual({ count: 0 });
  });

  it('keeps discovery as a suggestion until the user accepts it', () => {
    requireXopcDatabase().db.prepare(
      'INSERT INTO projects (project_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('project-1', 'Gateway', 'gateway', 1, 1);
    const [suggestion] = persistWorkThreadsFromDiscovery({
      projectId: 'project-1',
      result: {
        projectSummary: 'Gateway work',
        currentState: 'Quota work is active.',
        uncertainties: [],
        suggestions: [],
        workThreadCandidates: [{
          topicKey: 'gateway-quota',
          title: 'Gateway quota and billing',
          summary: 'Implement quota accounts and upstream pools.',
          status: 'active',
          horizon: 'current',
          confidence: 'high',
          evidenceRefs: ['git://quota'],
        }],
      },
      snapshot: {
        root: { displayName: 'Gateway', projectKind: 'coding', markerReasons: [] },
        structure: { sampledPaths: [], metadataOnlyFiles: [], omittedPathCount: 0 },
        documents: [],
        limits: { policyVersion: 1, fileCount: 0, contentBytes: 0, truncated: false },
      },
      evidence: [{
        id: 'evidence-1',
        investigationId: 'investigation-1',
        projectId: 'project-1',
        sourceType: 'git_commit',
        sourceRef: 'git://quota',
        observation: 'Recent changes touched quota accounting.',
        collectedAt: 100,
        sensitivity: 'normal',
      }],
      nowMs: 100,
    });

    expect(suggestion).toMatchObject({ title: 'Gateway quota and billing', userStatus: 'unreviewed' });
    expect(listFocuses()).toEqual([]);
    expect(listFocusCandidates()).toEqual([expect.objectContaining({ id: suggestion.id, status: 'pending' })]);

    const focus = acceptFocusCandidate(suggestion.id, 200);
    expect(focus).toMatchObject({ title: suggestion.title, source: 'discovery', status: 'active' });
    expect(acceptFocusCandidate(suggestion.id, 300)?.id).toBe(focus?.id);
  });

  it('upserts a repeated discovery candidate instead of duplicating it', () => {
    upsertFocusCandidate({ canonicalKey: 'project:topic', title: 'First', summary: 'One', confidence: 0.6 });
    upsertFocusCandidate({ canonicalKey: 'project:topic', title: 'Updated', summary: 'Two', confidence: 0.8 });
    expect(listFocusCandidates()).toEqual([expect.objectContaining({ title: 'Updated', confidence: 0.8 })]);
  });
});
