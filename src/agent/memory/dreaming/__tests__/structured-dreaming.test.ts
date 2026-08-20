import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendMemorySignal,
  closeXopcDatabase,
  getMemoryRecord,
  finishDreamingRun,
  listDreamingDecisions,
  listDreamingRuns,
  listMemoryRecords,
  listMemorySignals,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  startDreamingRun,
  upsertMemoryRecord,
} from '../../../../storage/sqlite/index.js';
import { runDreamingDeepPromotion } from '../deep-promotion.js';
import { runLightSweep } from '../light-sweep.js';
import { runRemPatterns } from '../rem-patterns.js';

describe('structured Dreaming', () => {
  let stateDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-structured-dreaming-'));
    workspaceDir = join(stateDir, 'workspace');
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('stages recent records in Light without scanning files', async () => {
    const record = upsertMemoryRecord({
      id: 'light-record', providerId: 'local', kind: 'preference', sourceAgentId: 'main',
      workspaceId: workspaceDir, content: 'Prefer concise design reviews.', status: 'active', importance: 0.8,
    });
    const run = startDreamingRun({ agentId: 'main', workspaceId: workspaceDir, phase: 'light', mode: 'observe', triggerKind: 'manual', algorithmVersion: 'test-v1', configSnapshot: {} });
    const result = await runLightSweep({
      runId: run.runId,
      workspaceDir,
      config: { enabled: true, lookbackDays: 2, limit: 100 },
    });
    expect(result.newSignals).toBe(1);
    expect(listMemorySignals({ recordId: record.id })).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'dreaming', metadata: expect.objectContaining({ phase: 'light' }) }),
    ]));
    finishDreamingRun({ runId: run.runId, ok: result.ok, reason: result.reason, metrics: result });
    expect(listDreamingRuns({ workspaceId: workspaceDir })[0]).toMatchObject({ status: 'completed', mode: 'observe', phase: 'light' });
    expect(listDreamingDecisions(run.runId)).toEqual([
      expect.objectContaining({ recordId: record.id, action: 'observe', reasonCode: 'recent_record_staged' }),
    ]);
  });

  it('promotes a candidate in Deep from unified recall signals', async () => {
    upsertMemoryRecord({
      id: 'deep-candidate', providerId: 'local', kind: 'task_lesson', sourceAgentId: 'main',
      workspaceId: workspaceDir, content: 'Run verification before release.', status: 'candidate', importance: 0.9,
    });
    for (const query of ['release check', 'verification steps', 'ship safely']) {
      appendMemorySignal({
        providerId: 'local', workspaceId: workspaceDir,
        signal: { source: 'context_injection', recordId: 'deep-candidate', score: 0.95, metadata: { query } },
      });
    }
    const run = startDreamingRun({ agentId: 'main', workspaceId: workspaceDir, phase: 'deep', mode: 'automatic', triggerKind: 'manual', algorithmVersion: 'test-v1', configSnapshot: {} });
    const result = await runDreamingDeepPromotion({
      runId: run.runId,
      agentId: 'main', workspaceDir, mode: 'automatic',
      config: { enabled: true, minScore: 0.8, minRecallCount: 3, minUniqueQueries: 3, limit: 10, recencyHalfLifeDays: 14, maxAgeDays: 30 },
    });
    expect(result.applied).toBe(1);
    expect(getMemoryRecord('deep-candidate')?.status).toBe('active');
    expect(result.memoryPath).toBe('sqlite://memory_records');
    expect(listDreamingDecisions(run.runId)).toEqual([
      expect.objectContaining({ recordId: 'deep-candidate', action: 'activate', reasonCode: 'deep_evidence_threshold_met' }),
    ]);
  });

  it('keeps REM insights reviewable even in automatic mode', async () => {
    for (const [id, content] of [['rem-a', 'Use short review notes.'], ['rem-b', 'Keep design reviews concise.']]) {
      upsertMemoryRecord({ id, providerId: 'local', kind: 'preference', sourceAgentId: 'main', workspaceId: workspaceDir, content, status: 'active' });
      appendMemorySignal({
        providerId: 'local', workspaceId: workspaceDir,
        signal: { source: 'search_recall', recordId: id, score: 0.9, metadata: { query: 'review style' } },
      });
    }
    const result = await runRemPatterns({
      runId: startDreamingRun({ agentId: 'main', workspaceId: workspaceDir, phase: 'rem', mode: 'automatic', triggerKind: 'manual', algorithmVersion: 'test-v1', configSnapshot: {} }).runId,
      agentId: 'main', workspaceDir, mode: 'automatic',
      config: { enabled: true, lookbackDays: 7, limit: 10, minPatternStrength: 0.5 },
    });
    expect(result.patternsDiscovered).toBe(1);
    expect(listMemoryRecords({ workspaceId: workspaceDir, kind: 'derived_insight', status: 'candidate' })).toHaveLength(1);
  });
});
