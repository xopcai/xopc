import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const releaseDir = join(process.cwd(), 'dist/release');

describe('verify-electron-asar-deps findDefaultAsar', () => {
  const created: string[] = [];

  afterEach(() => {
    for (const p of created.splice(0).reverse()) {
      rmSync(p, { recursive: true, force: true });
    }
  });

  function touchAsar(relativePath: string, mtimeMs: number) {
    const parts = relativePath.split('/');
    const topLevel = parts[0]!;
    const asarPath = join(releaseDir, relativePath);
    mkdirSync(join(asarPath, '..'), { recursive: true });
    writeFileSync(asarPath, 'fake-asar');
    utimesSync(asarPath, mtimeMs / 1000, mtimeMs / 1000);
    const topLevelDir = join(releaseDir, topLevel);
    if (!created.includes(topLevelDir)) {
      created.push(topLevelDir);
    }
    return asarPath;
  }

  it('finds the newest app.asar under mac, win, and linux unpacked dirs', async () => {
    touchAsar('mac/xopc.app/Contents/Resources/app.asar', Date.now() - 10_000);
    touchAsar('win-unpacked/resources/app.asar', Date.now() - 5_000);
    const newest = touchAsar('linux-unpacked/resources/app.asar', Date.now() + 1_000_000);

    const mod = await import('../verify-electron-asar-deps.mjs');
    expect(mod.findDefaultAsar()).toBe(newest);
  });
});
