import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ELECTRON_PACKAGED_DEPENDENCIES } from '../electron-runtime-externals.mjs';
import { prepareElectronPackDir } from '../prepare-electron-pack-dir.mjs';

describe('prepare-electron-pack-dir', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('stages minimal runtime node_modules when app artifacts exist', () => {
    const repoRoot = process.cwd();
    if (
      !existsSync(join(repoRoot, 'out/main/index.js')) ||
      !existsSync(join(repoRoot, 'out/server/index.js')) ||
      !existsSync(join(repoRoot, 'dist/electron/extensions')) ||
      !existsSync(join(repoRoot, 'dist/gateway/static/root/index.html'))
    ) {
      return;
    }

    const packDir = prepareElectronPackDir(repoRoot);
    tempRoots.push(packDir);

    const pkg = JSON.parse(readFileSync(join(packDir, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies).sort()).toEqual([...ELECTRON_PACKAGED_DEPENDENCIES].sort());
    expect(existsSync(join(packDir, 'out/main/index.js'))).toBe(true);
    expect(existsSync(join(packDir, 'dist/electron/extensions'))).toBe(true);
    expect(existsSync(join(packDir, 'dist/src'))).toBe(false);
    expect(existsSync(join(packDir, 'dist/extensions'))).toBe(false);
    expect(existsSync(join(packDir, 'dist/gateway/static/root/index.html'))).toBe(true);
    expect(existsSync(join(packDir, 'skills/tools/find-skills/SKILL.md'))).toBe(true);
    expect(existsSync(join(packDir, 'node_modules/node-cron'))).toBe(true);
    expect(existsSync(join(packDir, 'node_modules/silk-wasm'))).toBe(true);
    expect(existsSync(join(packDir, 'node_modules/@vscode/ripgrep'))).toBe(false);
    expect(existsSync(join(packDir, '_pack-resources/rg'))).toBe(true);
    expect(existsSync(join(packDir, 'node_modules/@earendil-works/pi-ai'))).toBe(false);
    // Pack dir lives outside the repo so `pnpm --workspace-root` (run by electron-builder)
    // returns nothing and the dep collector stays scoped to pack dir.
    expect(packDir.startsWith(repoRoot)).toBe(false);
    // Build inputs are staged so pack.yml can reference them via relative `_pack-resources/...`.
    expect(existsSync(join(packDir, '_pack-resources/electron-before-build.cjs'))).toBe(true);
    expect(existsSync(join(packDir, '_pack-resources/build-resources'))).toBe(true);
    expect(existsSync(join(packDir, '_pack-resources/playwright-core'))).toBe(true);
    expect(existsSync(join(packDir, '_pack-resources/browser-ext'))).toBe(true);
  });
});
