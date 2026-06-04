import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PACKAGE_VERSION } from '../../package-version.js';
import {
  BROWSER_EXT_REQUIRED_FILES,
  computeNeedsRefresh,
  ensureBrowserExtensionArtifacts,
  validateBrowserExtLayout,
} from '../providers/browser-ext-install.js';

function writeMinimalExtensionTree(root: string, version = '0.0.1'): void {
  mkdirSync(join(root, 'dist'), { recursive: true });
  mkdirSync(join(root, 'icons'), { recursive: true });
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({ manifest_version: 3, name: 'test', version }, null, 2),
  );
  writeFileSync(join(root, 'popup.html'), '<html></html>');
  for (const file of ['background.js', 'content.js', 'popup.js']) {
    writeFileSync(join(root, 'dist', file), `// ${file}`);
  }
  writeFileSync(join(root, 'icons/icon-16.png'), '');
}

describe('browser-ext-install', () => {
  let tempHome: string;
  let bundledDir: string;
  let binDir: string;
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  const prevBundledRoot = process.env.XOPC_BROWSER_EXT_BUNDLED_ROOT;
  const prevStateDir = process.env.XOPC_STATE_DIR;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'xopc-browser-ext-'));
    bundledDir = join(tempHome, 'bundled');
    binDir = join(tempHome, '.xopc', 'bin');
    mkdirSync(binDir, { recursive: true });
    writeMinimalExtensionTree(bundledDir, PACKAGE_VERSION);

    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    process.env.XOPC_BROWSER_EXT_BUNDLED_ROOT = bundledDir;
    process.env.XOPC_STATE_DIR = join(tempHome, '.xopc');
  });

  afterEach(() => {
    process.env.HOME = prevHome;
    process.env.USERPROFILE = prevUserProfile;
    if (prevBundledRoot === undefined) {
      delete process.env.XOPC_BROWSER_EXT_BUNDLED_ROOT;
    } else {
      process.env.XOPC_BROWSER_EXT_BUNDLED_ROOT = prevBundledRoot;
    }
    if (prevStateDir === undefined) {
      delete process.env.XOPC_STATE_DIR;
    } else {
      process.env.XOPC_STATE_DIR = prevStateDir;
    }
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('validateBrowserExtLayout requires core files', () => {
    expect(validateBrowserExtLayout(bundledDir)).toBe(true);
    expect(BROWSER_EXT_REQUIRED_FILES.length).toBeGreaterThan(0);
    rmSync(join(bundledDir, 'dist/background.js'));
    expect(validateBrowserExtLayout(bundledDir)).toBe(false);
  });

  it('computeNeedsRefresh when meta missing or force', () => {
    expect(
      computeNeedsRefresh({
        bundledManifestVersion: PACKAGE_VERSION,
        installedPath: null,
        meta: null,
      }),
    ).toBe(true);

    expect(
      computeNeedsRefresh({
        force: true,
        bundledManifestVersion: PACKAGE_VERSION,
        installedPath: bundledDir,
        meta: {
          xopcVersion: PACKAGE_VERSION,
          manifestVersion: PACKAGE_VERSION,
          source: 'bundled',
          bundledFrom: 'env-override',
          installedAt: new Date().toISOString(),
          installPath: bundledDir,
        },
      }),
    ).toBe(true);
  });

  it('ensure is idempotent on second run', async () => {
    const first = await ensureBrowserExtensionArtifacts({ cacheDir: binDir });
    expect(first.copied).toBe(true);
    expect(validateBrowserExtLayout(first.extensionDir)).toBe(true);
    expect(first.extensionDir).toBe(join(binDir, 'browser-ext', PACKAGE_VERSION));

    const second = await ensureBrowserExtensionArtifacts({ cacheDir: binDir });
    expect(second.copied).toBe(false);
    expect(second.extensionDir).toBe(first.extensionDir);
  });

  it('ensure refreshes when bundled manifest version changes', async () => {
    const nextVersion = '9.9.9';
    await ensureBrowserExtensionArtifacts({ cacheDir: binDir });
    writeFileSync(
      join(bundledDir, 'manifest.json'),
      JSON.stringify({ manifest_version: 3, name: 'test', version: nextVersion }, null, 2),
    );

    const upgraded = await ensureBrowserExtensionArtifacts({ cacheDir: binDir });
    expect(upgraded.copied).toBe(true);
    expect(upgraded.extensionDir).toBe(join(binDir, 'browser-ext', nextVersion));
    const manifest = JSON.parse(readFileSync(join(upgraded.extensionDir, 'manifest.json'), 'utf8')) as {
      version: string;
    };
    expect(manifest.version).toBe(nextVersion);
    expect(existsSync(join(binDir, 'browser-ext', PACKAGE_VERSION))).toBe(false);
  });

  it('rejects cacheDir outside home', async () => {
    await expect(
      ensureBrowserExtensionArtifacts({ cacheDir: '/tmp/not-allowed' }),
    ).rejects.toThrow(/home directory/i);
  });

  it('removes stale version directories during refresh', async () => {
    const root = join(binDir, 'browser-ext');
    mkdirSync(join(root, '0.0.99-stale'), { recursive: true });
    writeFileSync(join(root, '0.0.99-stale', 'marker.txt'), 'stale');
    writeMinimalExtensionTree(join(root, '0.0.88'), '0.0.88');

    await ensureBrowserExtensionArtifacts({ cacheDir: binDir });

    expect(existsSync(join(root, '0.0.99-stale'))).toBe(false);
    expect(existsSync(join(root, '0.0.88'))).toBe(false);
    expect(existsSync(join(root, PACKAGE_VERSION))).toBe(true);
  });
});
