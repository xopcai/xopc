import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { collectRecentFileItems } from '../understanding-sources/recent-files.js';

describe('recent file understanding source', () => {
  const paths: string[] = [];

  afterEach(async () => {
    await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('collects bounded document text without exposing absolute paths', async () => {
    const home = await mkdtemp(join(tmpdir(), 'xopc-recent-files-'));
    paths.push(home);
    await mkdir(join(home, 'Desktop', 'Launch'), { recursive: true });
    await mkdir(join(home, 'Downloads'), { recursive: true });
    await mkdir(join(home, 'Documents'), { recursive: true });
    await writeFile(join(home, 'Desktop', 'Launch', 'Product plan.md'), '# Launch\nShip the onboarding understanding flow.');
    await writeFile(join(home, 'Downloads', 'installer.dmg'), 'binary');
    await writeFile(join(home, 'Documents', '.env'), 'SECRET=value');

    const items = await collectRecentFileItems({
      homeDirectory: home,
      platform: 'darwin',
      environment: {},
      nowMs: Date.now(),
    });

    expect(items).toEqual([expect.objectContaining({
      sourceId: 'local-recent-files',
      type: 'document',
      title: 'Product plan.md',
      group: expect.stringMatching(/^Desktop\/area-[a-f0-9]{8}$/),
      text: expect.stringContaining('Ship the onboarding understanding flow.'),
    })]);
    expect(JSON.stringify(items[0])).not.toContain(home);
  });

  it('supports fast onboarding mode budgets and excludes user-dismissed file ids', async () => {
    const home = await mkdtemp(join(tmpdir(), 'xopc-recent-files-fast-'));
    paths.push(home);
    await mkdir(join(home, 'Desktop'), { recursive: true });
    await mkdir(join(home, 'Documents'), { recursive: true });
    await mkdir(join(home, 'Downloads'), { recursive: true });

    const longBody = 'a'.repeat(4_000);
    for (let i = 0; i < 20; i += 1) {
      await writeFile(join(home, 'Desktop', `doc-${String(i).padStart(2, '0')}.md`), `# Doc ${i}\n${longBody}`);
    }

    const full = await collectRecentFileItems({
      homeDirectory: home,
      platform: 'darwin',
      environment: {},
      nowMs: Date.now(),
      mode: 'fast',
    });
    expect(full).toHaveLength(16);
    expect(full[0]?.text?.length).toBeLessThanOrEqual(2_400);
    expect(full.reduce((sum, entry) => sum + (entry.text?.length ?? 0), 0)).toBeLessThanOrEqual(24_000);

    const excludedPrefix = full[0]!.id.slice(0, 16);
    const filtered = await collectRecentFileItems({
      homeDirectory: home,
      platform: 'darwin',
      environment: {},
      nowMs: Date.now(),
      mode: 'fast',
      excludeIds: [excludedPrefix],
    });
    expect(filtered.some((entry) => entry.id === full[0]!.id)).toBe(false);
  });
});
