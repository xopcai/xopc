import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { memoryGet, memorySearch } from '../index.js';

describe('memorySearch with memoriesDir', () => {
  it('finds curated USER.md under agent memoriesDir', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-ws-'));
    const memoriesDir = await mkdtemp(join(tmpdir(), 'xopc-mem-'));
    await writeFile(join(memoriesDir, 'USER.md'), 'User prefers 稀饭 for breakfast.\n', 'utf-8');

    const results = await memorySearch(workspace, '稀饭', { memoriesDir, minScore: 0.2 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.lines.includes('稀饭'))).toBe(true);
  });

  it('returns no curated hits when memoriesDir is undefined', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-ws-'));
    const hiddenMem = await mkdtemp(join(tmpdir(), 'xopc-mem-'));
    await writeFile(join(hiddenMem, 'USER.md'), 'secret curated line\n', 'utf-8');

    const results = await memorySearch(workspace, 'secret', { memoriesDir: undefined, minScore: 0.2 });
    expect(results.every((r) => !r.lines.includes('secret'))).toBe(true);
  });
});

describe('memoryGet with memoriesDir', () => {
  it('reads USER.md from memoriesDir when not in workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-ws-'));
    const memoriesDir = await mkdtemp(join(tmpdir(), 'xopc-mem-'));
    await writeFile(join(memoriesDir, 'USER.md'), 'alpha\nbeta\ngamma\n', 'utf-8');

    const r = memoryGet(workspace, 'USER.md', 1, 2, memoriesDir);
    expect(r).not.toBeNull();
    expect(r!.content).toContain('alpha');
    expect(r!.content).toContain('beta');
    expect(r!.content).not.toContain('gamma');
  });

  it('does not resolve arbitrary filenames under memoriesDir', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-ws-'));
    const memoriesDir = await mkdtemp(join(tmpdir(), 'xopc-mem-'));
    await writeFile(join(memoriesDir, 'other.md'), 'nope\n', 'utf-8');

    const r = memoryGet(workspace, 'other.md', 1, 10, memoriesDir);
    expect(r).toBeNull();
  });
});
