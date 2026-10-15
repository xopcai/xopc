import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

describe('verify-electron-asar-deps findDefaultAsar', () => {
  const created: string[] = [];

  afterEach(() => {
    for (const p of created.splice(0).reverse()) {
      rmSync(p, { recursive: true, force: true });
    }
  });

  function touchAsar(releaseDir: string, relativePath: string, mtimeMs: number) {
    const asarPath = join(releaseDir, relativePath);
    mkdirSync(join(asarPath, '..'), { recursive: true });
    writeFileSync(asarPath, 'fake-asar');
    utimesSync(asarPath, mtimeMs / 1000, mtimeMs / 1000);
    return asarPath;
  }

  it('finds the newest app.asar under mac, win, and linux unpacked dirs', async () => {
    const releaseDir = mkdtempSync(join(tmpdir(), 'xopc-electron-asar-test-'));
    created.push(releaseDir);
    touchAsar(releaseDir, 'mac/xopc.app/Contents/Resources/app.asar', Date.now() - 10_000);
    touchAsar(releaseDir, 'win-unpacked/resources/app.asar', Date.now() - 5_000);
    const newest = touchAsar(releaseDir, 'linux-unpacked/resources/app.asar', Date.now() + 1_000_000);

    const mod = await import('../verify-electron-asar-deps.mjs');
    expect(mod.findDefaultAsar(releaseDir)).toBe(newest);
  });

  it('budgets for the packaged PDF and native runtimes', async () => {
    const mod = await import('../verify-electron-asar-deps.mjs');
    expect(mod.DEFAULT_MAX_NODE_MODULES_BYTES).toBe(125 * 1024 * 1024);
  });
});
