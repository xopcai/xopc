import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runLightSweep } from '../light-sweep.js';
import { loadDreamingStore } from '../short-term-store.js';

describe('runLightSweep', () => {
  let root: string;
  let workspaceDir: string;
  let dreamingRoot: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xopc-dreaming-light-'));
    workspaceDir = join(root, 'workspace');
    dreamingRoot = join(root, 'memories');
    mkdirSync(join(workspaceDir, 'memory'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('scans recent prose, skips fenced code, and is idempotent until the file changes', async () => {
    const file = join(workspaceDir, 'memory', 'daily.md');
    writeFileSync(file, [
      '# Daily notes',
      'The user prefers concise weekly status summaries.',
      '```text',
      'This fenced secret must not become a memory signal.',
      '```',
    ].join('\n'), 'utf-8');
    const firstMtime = new Date('2026-07-16T10:00:00.000Z');
    utimesSync(file, firstMtime, firstMtime);
    const config = { enabled: true, lookbackDays: 2, limit: 100, dedupeSimilarity: 0.9 };

    const first = await runLightSweep({ workspaceDir, dreamingRoot, config, now: new Date('2026-07-17T00:00:00.000Z') });
    const second = await runLightSweep({ workspaceDir, dreamingRoot, config, now: new Date('2026-07-17T06:00:00.000Z') });
    let { store } = await loadDreamingStore({ dreamingRoot });
    const entry = store.entries['memory/daily.md#2-2'];

    expect(first).toMatchObject({ ok: true, scannedEntries: 1, newSignals: 1 });
    expect(second).toMatchObject({ ok: true, scannedEntries: 1, newSignals: 0, deduped: 1 });
    expect(Object.values(store.entries)).toHaveLength(1);
    expect(entry).toMatchObject({ sourceCount: 1, lightHits: 1, lastObservedAt: firstMtime.toISOString() });
    expect(Object.values(store.entries).some((item) => item.snippet.includes('fenced secret'))).toBe(false);

    writeFileSync(file, 'The user prefers concise weekly status summaries with risks.\n', 'utf-8');
    const changedMtime = new Date('2026-07-17T07:00:00.000Z');
    utimesSync(file, changedMtime, changedMtime);
    await runLightSweep({ workspaceDir, dreamingRoot, config, now: new Date('2026-07-17T08:00:00.000Z') });
    ({ store } = await loadDreamingStore({ dreamingRoot }));

    expect(store.entries['memory/daily.md#1-1']).toMatchObject({ sourceCount: 1, lightHits: 1 });
  });

  it('applies the limit after stable newest-first ordering', async () => {
    const older = join(workspaceDir, 'memory', 'a.md');
    const newer = join(workspaceDir, 'memory', 'b.md');
    writeFileSync(older, 'Older but still relevant memory line.\n', 'utf-8');
    writeFileSync(newer, 'Newest relevant memory line wins the limit.\n', 'utf-8');
    utimesSync(older, new Date('2026-07-16T00:00:00Z'), new Date('2026-07-16T00:00:00Z'));
    utimesSync(newer, new Date('2026-07-17T00:00:00Z'), new Date('2026-07-17T00:00:00Z'));

    await runLightSweep({
      workspaceDir,
      dreamingRoot,
      config: { enabled: true, lookbackDays: 3, limit: 1, dedupeSimilarity: 0.9 },
      now: new Date('2026-07-17T01:00:00Z'),
    });
    const { store } = await loadDreamingStore({ dreamingRoot });

    expect(Object.values(store.entries).map((entry) => entry.path)).toEqual(['memory/b.md']);
  });
});
