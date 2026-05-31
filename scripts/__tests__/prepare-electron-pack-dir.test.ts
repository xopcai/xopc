import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
    if (!existsSync(join(repoRoot, 'out/main/index.js'))) {
      return;
    }

    const packDir = prepareElectronPackDir(repoRoot);
    tempRoots.push(packDir);

    const pkg = JSON.parse(readFileSync(join(packDir, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies).sort()).toEqual([...ELECTRON_PACKAGED_DEPENDENCIES].sort());
    expect(existsSync(join(packDir, 'out/main/index.js'))).toBe(true);
    expect(existsSync(join(packDir, 'node_modules/node-cron'))).toBe(true);
    expect(existsSync(join(packDir, 'node_modules/silk-wasm'))).toBe(true);
    expect(existsSync(join(packDir, 'node_modules/@vscode/ripgrep'))).toBe(true);
    expect(existsSync(join(packDir, 'node_modules/@earendil-works/pi-ai'))).toBe(false);
  });
});
