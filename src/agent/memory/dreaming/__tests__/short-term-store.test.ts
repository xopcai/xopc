import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearStaleDreamingLock,
  loadDreamingStore,
  recordDreamingRecalls,
  saveDreamingStore,
  withDreamingStoreLock,
  type DreamingStore,
} from '../short-term-store.js';

describe('Dreaming short-term store', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xopc-dreaming-store-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('serializes concurrent recalls without losing updates', async () => {
    const match = { file: 'memory/project.md', lines: 'The release uses a staged rollout.', score: 0.9, lineNumbers: [4] };
    await Promise.all(Array.from({ length: 20 }, (_, index) => recordDreamingRecalls({
      dreamingRoot: root,
      query: `release ${index}`,
      matches: [match],
    })));

    const { store } = await loadDreamingStore({ dreamingRoot: root });
    const entry = store.entries['memory/project.md#4-4'];
    expect(entry?.recallCount).toBe(20);
    expect(entry?.totalSignalCount).toBe(20);
    expect(entry?.queryHashes).toHaveLength(20);
  });

  it('recovers a stale lock owned by a dead process', async () => {
    const dreamsDir = join(root, '.dreams');
    const lockPath = join(dreamsDir, 'short-term-promotion.lock');
    mkdirSync(dreamsDir, { recursive: true });
    writeFileSync(lockPath, '999999999:0\n', 'utf-8');
    const stale = new Date(Date.now() - 120_000);
    utimesSync(lockPath, stale, stale);

    await expect(withDreamingStoreLock(root, async () => 'recovered')).resolves.toBe('recovered');
  });

  it('refuses to clear a stale-looking lock owned by the live process', async () => {
    const dreamsDir = join(root, '.dreams');
    const lockPath = join(dreamsDir, 'short-term-promotion.lock');
    mkdirSync(dreamsDir, { recursive: true });
    writeFileSync(lockPath, `${process.pid}:0\n`, 'utf-8');
    const stale = new Date(Date.now() - 120_000);
    utimesSync(lockPath, stale, stale);

    await expect(clearStaleDreamingLock(root)).rejects.toThrow('lock is active');
  });

  it('quarantines corrupt JSON instead of overwriting it in place', async () => {
    const dreamsDir = join(root, '.dreams');
    mkdirSync(dreamsDir, { recursive: true });
    writeFileSync(join(dreamsDir, 'short-term-recall.json'), '{not-json', 'utf-8');

    const { store } = await loadDreamingStore({ dreamingRoot: root });

    expect(store.entries).toEqual({});
    expect(readdirSync(dreamsDir).some((name) => name.startsWith('short-term-recall.json.corrupt-'))).toBe(true);
  });

  it('prunes expired and excess entries on write', async () => {
    const now = Date.now();
    const recent = new Date(now - 1_000).toISOString();
    const old = new Date(now - 100 * 24 * 60 * 60 * 1_000).toISOString();
    const entries: DreamingStore['entries'] = {};
    for (let index = 0; index < 2_010; index += 1) {
      const key = `memory/${index}.md:1-1`;
      entries[key] = {
        key, path: `memory/${index}.md`, startLine: 1, endLine: 1, snippet: `Memory ${index}`,
        recallCount: 1, sourceCount: 0, groundedCount: 0, lightHits: 0, remHits: 0,
        phaseHitCount: 0, totalSignalCount: index + 1, totalScore: 1, maxScore: 1,
        queryHashes: ['q'], recallDays: [recent.slice(0, 10)], firstRecalledAt: recent, lastRecalledAt: recent,
      };
    }
    entries['memory/expired.md:1-1'] = {
      ...entries['memory/0.md:1-1']!, key: 'memory/expired.md:1-1', path: 'memory/expired.md',
      firstRecalledAt: old, lastRecalledAt: old,
    };

    await saveDreamingStore({ dreamingRoot: root, store: { version: 1, updatedAt: recent, entries } });
    const { store } = await loadDreamingStore({ dreamingRoot: root });

    expect(Object.keys(store.entries)).toHaveLength(2_000);
    expect(store.entries['memory/expired.md:1-1']).toBeUndefined();
    expect(store.entries['memory/2009.md:1-1']).toBeDefined();
  });
});
