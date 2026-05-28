import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  defaultCloakBrowserCacheDir,
  migrateLegacyCloakBrowserLayout,
  resolveCloakBrowserCacheDir,
} from '../providers/cloakbrowser.js';

const binDirState = vi.hoisted(() => ({ path: '' }));

vi.mock('../../config/paths.js', () => ({
  resolveBinDir: () => binDirState.path,
}));

describe('CloakBrowser cache directory layout', () => {
  it('defaults to ~/.xopc/bin/cloakbrowser under resolveBinDir()', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xopc-cloak-cache-'));
    binDirState.path = root;
    expect(defaultCloakBrowserCacheDir()).toBe(join(root, 'cloakbrowser'));
    expect(resolveCloakBrowserCacheDir()).toBe(join(root, 'cloakbrowser'));
  });

  it('honors an explicit configured cacheDir', async () => {
    const customRoot = await mkdtemp(join(homedir(), '.xopc-cloak-test-'));
    const custom = join(customRoot, 'my-cloak');
    expect(resolveCloakBrowserCacheDir(custom)).toBe(custom);
  });

  it('migrates legacy chromium-v* and profiles from bin root into cloakbrowser/', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xopc-cloak-migrate-'));
    binDirState.path = root;

    const legacyBinaryDir = join(root, 'chromium-v145.0.7632.109.2');
    await mkdir(legacyBinaryDir, { recursive: true });
    await writeFile(join(legacyBinaryDir, 'chrome'), 'stub');

    const legacyProfiles = join(root, 'profiles', 'default');
    await mkdir(legacyProfiles, { recursive: true });
    await writeFile(join(legacyProfiles, 'Preferences'), '{}');

    const cacheDir = defaultCloakBrowserCacheDir();
    await migrateLegacyCloakBrowserLayout(cacheDir);

    expect(await fileExists(join(cacheDir, 'chromium-v145.0.7632.109.2', 'chrome'))).toBe(true);
    expect(await fileExists(join(cacheDir, 'profiles', 'default', 'Preferences'))).toBe(true);
    expect(await fileExists(join(root, 'chromium-v145.0.7632.109.2'))).toBe(false);
    expect(await fileExists(join(root, 'profiles'))).toBe(false);
  });

  it('skips migration for custom cacheDir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xopc-cloak-custom-'));
    binDirState.path = root;

    const legacyBinaryDir = join(root, 'chromium-v9.9.9.9');
    await mkdir(legacyBinaryDir, { recursive: true });

    const custom = join(root, 'custom-cloak');
    await migrateLegacyCloakBrowserLayout(custom);

    expect(await fileExists(join(root, 'chromium-v9.9.9.9'))).toBe(true);
    expect(await fileExists(join(custom, 'chromium-v9.9.9.9'))).toBe(false);
  });
});

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
