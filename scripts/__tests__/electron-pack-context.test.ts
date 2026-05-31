import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PNPM_WORKSPACE_MARKER_FILES,
  hidePnpmWorkspaceMarkers,
  restorePnpmWorkspaceMarkers,
  withElectronPackContext,
} from '../electron-pack-context.mjs';

describe('electron-pack-context', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function makeTempRoot() {
    const root = mkdtempSync(join(tmpdir(), 'xopc-electron-pack-'));
    tempRoots.push(root);
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify(
        {
          name: 'x',
          version: '0.0.0',
          dependencies: {
            'node-cron': '^4.2.1',
            'silk-wasm': '^3.7.1',
            '@vscode/ripgrep': '^1.18.0',
            hono: '^4.0.0',
          },
          devDependencies: { electron: '^41.7.1' },
        },
        null,
        2,
      ),
    );
    for (const name of PNPM_WORKSPACE_MARKER_FILES) {
      writeFileSync(join(root, name), `# ${name}\n`);
    }
    return root;
  }

  it('hides and restores pnpm workspace marker files', () => {
    const root = makeTempRoot();
    const backups = hidePnpmWorkspaceMarkers(root);
    expect(backups).toHaveLength(PNPM_WORKSPACE_MARKER_FILES.length);
    for (const name of PNPM_WORKSPACE_MARKER_FILES) {
      expect(existsSync(join(root, name))).toBe(false);
      expect(existsSync(join(root, `.electron-pack-${name}.bak`))).toBe(true);
    }
    restorePnpmWorkspaceMarkers(backups);
    for (const name of PNPM_WORKSPACE_MARKER_FILES) {
      expect(existsSync(join(root, name))).toBe(true);
      expect(existsSync(join(root, `.electron-pack-${name}.bak`))).toBe(false);
    }
  });

  it('withElectronPackContext restores workspace markers after run', () => {
    const root = makeTempRoot();
    const original = readFileSync(join(root, 'package.json'), 'utf8');

    withElectronPackContext(root, () => {
      for (const name of PNPM_WORKSPACE_MARKER_FILES) {
        expect(existsSync(join(root, name))).toBe(false);
      }
    });

    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(original);
    for (const name of PNPM_WORKSPACE_MARKER_FILES) {
      expect(existsSync(join(root, name))).toBe(true);
    }
  });
});
