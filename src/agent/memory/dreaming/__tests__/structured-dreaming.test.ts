import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendMemorySignal,
  closeXopcDatabase,
  getMemoryRecord,
  listMemoryRecords,
  listMemorySignals,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
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
    const result = await runLightSweep({
      workspaceDir,
      config: { enabled: true, lookbackDays: 2, limit: 100 },
    });
    expect(result.newSignals).toBe(1);
    expect(listMemorySignals({ recordId: record.id })).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'dreaming', metadata: expect.objectContaining({ phase: 'light' }) }),
    ]));
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
    const result = await runDreamingDeepPromotion({
      agentId: 'main', workspaceDir, promotionWritePolicy: 'allow',
      config: { enabled: true, minScore: 0.8, minRecallCount: 3, minUniqueQueries: 3, limit: 10, recencyHalfLifeDays: 14, maxAgeDays: 30 },
    });
    expect(result.applied).toBe(1);
    expect(getMemoryRecord('deep-candidate')?.status).toBe('active');
    expect(result.memoryPath).toBe('sqlite://memory_records');
  });

  it('creates reviewable REM insights when writes require confirmation', async () => {
    for (const [id, content] of [['rem-a', 'Use short review notes.'], ['rem-b', 'Keep design reviews concise.']]) {
      upsertMemoryRecord({ id, providerId: 'local', kind: 'preference', sourceAgentId: 'main', workspaceId: workspaceDir, content, status: 'active' });
      appendMemorySignal({
        providerId: 'local', workspaceId: workspaceDir,
        signal: { source: 'search_recall', recordId: id, score: 0.9, metadata: { query: 'review style' } },
      });
    }
    const result = await runRemPatterns({
      agentId: 'main', workspaceDir, promotionWritePolicy: 'confirm',
      config: { enabled: true, lookbackDays: 7, limit: 10, minPatternStrength: 0.5 },
    });
    expect(result.patternsDiscovered).toBe(1);
    expect(listMemoryRecords({ workspaceId: workspaceDir, kind: 'derived_insight', status: 'candidate' })).toHaveLength(1);
  });
});
