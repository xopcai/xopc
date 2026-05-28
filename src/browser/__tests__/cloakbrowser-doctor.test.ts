import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { cloakBrowserDoctor } from '../providers/cloakbrowser.js';

const binDirState = vi.hoisted(() => ({ path: '' }));

vi.mock('../../config/paths.js', () => ({
  resolveBinDir: () => binDirState.path,
}));

describe('cloakBrowserDoctor', () => {
  it('detects binary under default cloakbrowser layout', async () => {
    const root = await mkdtemp(join(homedir(), '.xopc-cloak-doctor-'));
    const cacheDir = join(root, 'cloakbrowser');
    binDirState.path = root;

    const execPath = join(
      cacheDir,
      'chromium-v145.0.7632.109.2',
      'Chromium.app/Contents/MacOS/Chromium',
    );
    await mkdir(join(execPath, '..'), { recursive: true });
    await writeFile(execPath, 'stub');

    const result = await cloakBrowserDoctor({});
    expect(result.installed).toBe(true);
    expect(result.binaryPath).toBe(execPath);
    expect(result.cacheDir).toBe(cacheDir);
  });

  it('falls back to auto path when configured binaryPath is stale', async () => {
    const root = await mkdtemp(join(homedir(), '.xopc-cloak-doctor-fb-'));
    const cacheDir = join(root, 'cloakbrowser');
    binDirState.path = root;

    const autoPath = join(
      cacheDir,
      'chromium-v145.0.7632.109.2',
      'Chromium.app/Contents/MacOS/Chromium',
    );
    await mkdir(join(autoPath, '..'), { recursive: true });
    await writeFile(autoPath, 'stub');

    const stalePath = join(root, 'chromium-v145.0.7632.109.2', 'Chromium.app/Contents/MacOS/Chromium');

    const result = await cloakBrowserDoctor({ binaryPath: stalePath });
    expect(result.installed).toBe(true);
    expect(result.binaryPath).toBe(autoPath);
  });
});
