import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runDreamingDeepPromotion } from '../deep-promotion.js';
import { saveDreamingStore, type DreamingStore } from '../short-term-store.js';
import {
  closeXopcDatabase,
  listMemoryRecords,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';

describe('runDreamingDeepPromotion', () => {
  let root: string;
  let workspaceDir: string;
  let dreamingRoot: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xopc-dreaming-deep-'));
    workspaceDir = join(root, 'workspace');
    dreamingRoot = join(root, 'agents', 'research', 'memories');
    mkdirSync(join(workspaceDir, 'memory'), { recursive: true });
    mkdirSync(dreamingRoot, { recursive: true });
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(root, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(root, { recursive: true, force: true });
  });

  it('promotes eligible snippets into the selected agent memory root', async () => {
    const now = new Date('2026-07-08T00:00:00.000Z');
    writeFileSync(join(workspaceDir, 'memory', 'daily.md'), 'Remember the launch checklist.\n', 'utf-8');
    const store: DreamingStore = {
      version: 1,
      updatedAt: now.toISOString(),
      entries: {
        'memory/daily.md:1-1': {
          key: 'memory/daily.md:1-1',
          path: 'memory/daily.md',
          startLine: 1,
          endLine: 1,
          snippet: 'Remember the launch checklist.',
          recallCount: 2,
          sourceCount: 0,
          groundedCount: 0,
          lightHits: 0,
          remHits: 0,
          phaseHitCount: 0,
          totalSignalCount: 2,
          totalScore: 1.9,
          maxScore: 0.95,
          queryHashes: ['q1'],
          recallDays: ['2026-07-08'],
          firstRecalledAt: now.toISOString(),
          lastRecalledAt: now.toISOString(),
        },
      },
    };
    await saveDreamingStore({ dreamingRoot, store });

    const result = await runDreamingDeepPromotion({
      agentId: 'research',
      workspaceDir,
      dreamingRoot,
      now,
      config: { enabled: true, minRecallCount: 1, minUniqueQueries: 1, minScore: 0.5, limit: 10 },
    });

    expect(result.applied).toBe(1);
    const agentMemory = readFileSync(join(dreamingRoot, 'MEMORY.md'), 'utf-8');
    expect(agentMemory).toContain('Remember the launch checklist.');
    expect(existsSync(join(workspaceDir, 'MEMORY.md'))).toBe(false);
    expect(listMemoryRecords({ agentId: 'research', status: 'active' })).toEqual([
      expect.objectContaining({
        kind: 'project_context',
        content: 'Remember the launch checklist.',
        canonicalKey: 'dreaming:memory/daily.md:1-1',
      }),
    ]);
  });

  it('does not promote sensitive snippets without an allow policy', async () => {
    const now = new Date('2026-07-08T00:00:00.000Z');
    writeFileSync(join(workspaceDir, 'memory', 'secret.md'), 'API key: sk-1234567890abcdef\n', 'utf-8');
    await saveDreamingStore({
      dreamingRoot,
      store: {
        version: 1,
        updatedAt: now.toISOString(),
        entries: {
          'memory/secret.md:1-1': {
            key: 'memory/secret.md:1-1',
            path: 'memory/secret.md',
            startLine: 1,
            endLine: 1,
            snippet: 'API key: sk-1234567890abcdef',
            recallCount: 3,
            sourceCount: 0,
            groundedCount: 0,
            lightHits: 0,
            remHits: 0,
            phaseHitCount: 0,
            totalSignalCount: 3,
            totalScore: 2.9,
            maxScore: 0.98,
            queryHashes: ['q1'],
            recallDays: ['2026-07-08'],
            firstRecalledAt: now.toISOString(),
            lastRecalledAt: now.toISOString(),
          },
        },
      },
    });

    const result = await runDreamingDeepPromotion({
      agentId: 'research',
      workspaceDir,
      dreamingRoot,
      now,
      config: { enabled: true, minRecallCount: 1, minUniqueQueries: 1, minScore: 0.5, limit: 10 },
      sensitiveWritePolicy: 'confirm',
    });

    expect(result.applied).toBe(0);
    expect(listMemoryRecords({ agentId: 'research' })).toEqual([]);
    expect(existsSync(join(dreamingRoot, 'MEMORY.md'))).toBe(false);
  });
});
