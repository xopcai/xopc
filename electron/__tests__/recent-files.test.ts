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
});
