import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { memoryGet, memorySearch } from '../index.js';

describe('memorySearch with memoriesDir', () => {
  it('finds global user memory when userMemoryPath is provided', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-ws-'));
    const memoriesDir = await mkdtemp(join(tmpdir(), 'xopc-mem-'));
    const userMemoryPath = join(await mkdtemp(join(tmpdir(), 'xopc-user-')), 'MEMORY.md');
    await writeFile(userMemoryPath, 'User prefers 稀饭 for breakfast.\n', 'utf-8');

    const results = await memorySearch(workspace, '稀饭', { memoriesDir, userMemoryPath, minScore: 0.2 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.lines.includes('稀饭'))).toBe(true);
  });

  it('returns no global user memory hits when userMemoryPath is undefined', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-ws-'));
    const hiddenMem = join(await mkdtemp(join(tmpdir(), 'xopc-user-')), 'MEMORY.md');
    await writeFile(hiddenMem, 'secret curated line\n', 'utf-8');

    const results = await memorySearch(workspace, 'secret', { memoriesDir: undefined, minScore: 0.2 });
    expect(results.every((r) => !r.lines.includes('secret'))).toBe(true);
  });
});

describe('memoryGet with memoriesDir', () => {
  it('reads global user memory when not in workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-ws-'));
    const memoriesDir = await mkdtemp(join(tmpdir(), 'xopc-mem-'));
    const userMemoryPath = join(await mkdtemp(join(tmpdir(), 'xopc-user-')), 'MEMORY.md');
    await writeFile(userMemoryPath, 'alpha\nbeta\ngamma\n', 'utf-8');

    const r = memoryGet(workspace, 'user/MEMORY.md', 1, 2, memoriesDir, userMemoryPath);
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
