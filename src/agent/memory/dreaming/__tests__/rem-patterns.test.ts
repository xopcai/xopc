import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  listMemoryRecords,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import { runRemPatterns } from '../rem-patterns.js';
import { saveDreamingStore, type DreamingStore, type DreamingStoreEntry } from '../short-term-store.js';

function entry(path: string, snippet: string, now: string): DreamingStoreEntry {
  const key = `${path}:1-1`;
  return {
    key, path, startLine: 1, endLine: 1, snippet,
    recallCount: 2, sourceCount: 0, groundedCount: 0, lightHits: 0, remHits: 0,
    phaseHitCount: 0, totalSignalCount: 2, totalScore: 1.8, maxScore: 0.9,
    queryHashes: ['shared-query'], recallDays: [now.slice(0, 10)], firstRecalledAt: now, lastRecalledAt: now,
  };
}

describe('runRemPatterns', () => {
  let root: string;
  let workspaceDir: string;
  let dreamingRoot: string;
  const now = new Date('2026-07-17T00:00:00.000Z');

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'xopc-dreaming-rem-'));
    workspaceDir = join(root, 'workspace');
    dreamingRoot = join(root, 'agents', 'research', 'memories');
    mkdirSync(dreamingRoot, { recursive: true });
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(root, 'xopc.db') });
    const first = entry('memory/a.md', 'The user wants weekly release risk summaries.', now.toISOString());
    const second = entry('memory/b.md', 'Release reviews should highlight risks before details.', now.toISOString());
    const store: DreamingStore = {
      version: 1,
      updatedAt: now.toISOString(),
      entries: { [first.key]: first, [second.key]: second },
    };
    await saveDreamingStore({ dreamingRoot, store });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(root, { recursive: true, force: true });
  });

  it('upserts one stable scoped derived insight and diary marker', async () => {
    const params = {
      agentId: 'research', workspaceDir, dreamingRoot, now,
      config: { enabled: true, lookbackDays: 7, limit: 10, minPatternStrength: 0.5 },
      promotionWritePolicy: 'allow' as const,
    };
    await runRemPatterns(params);
    await runRemPatterns(params);

    const records = listMemoryRecords({ status: 'active' });
    expect(records).toEqual([expect.objectContaining({
      kind: 'derived_insight',
      scope: expect.objectContaining({ userId: 'local-owner', workspaceId: workspaceDir }),
      provenance: { sourceAgentId: 'research' },
      canonicalKey: expect.stringMatching(/^dreaming-rem:/),
      content: expect.stringContaining('Recurring context across 2 memory sources'),
    })]);
    const diary = readFileSync(join(dreamingRoot, 'DREAMS.md'), 'utf-8');
    expect(diary.match(/xopc-rem-pattern id=/g)).toHaveLength(1);
  });

  it.each(['deny', 'confirm'] as const)('does not activate structured insight when policy is %s', async (policy) => {
    const result = await runRemPatterns({
      agentId: 'research', workspaceDir, dreamingRoot, now,
      config: { enabled: true, lookbackDays: 7, limit: 10, minPatternStrength: 0.5 },
      promotionWritePolicy: policy,
    });

    expect(result.patternsDiscovered).toBe(1);
    expect(listMemoryRecords()).toEqual([]);
  });
});
