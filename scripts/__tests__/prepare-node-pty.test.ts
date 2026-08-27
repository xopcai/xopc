import { accessSync, constants, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { prepareNodePtyPackage } from '../prepare-node-pty.mjs';

describe('prepareNodePtyPackage', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('makes the macOS spawn helper executable', () => {
    const root = join(tmpdir(), `xopc-node-pty-${process.pid}-${Date.now()}`);
    roots.push(root);
    const prebuild = join(root, 'prebuilds/darwin-arm64');
    mkdirSync(prebuild, { recursive: true });
    writeFileSync(join(prebuild, 'pty.node'), 'fixture');
    writeFileSync(join(prebuild, 'spawn-helper'), 'fixture', { mode: 0o644 });

    prepareNodePtyPackage(root, { platform: 'darwin', arch: 'arm64' });

    expect(() => accessSync(join(prebuild, 'spawn-helper'), constants.X_OK)).not.toThrow();
  });

  it('rejects a package without a target native module', () => {
    const root = join(tmpdir(), `xopc-node-pty-missing-${process.pid}-${Date.now()}`);
    roots.push(root);
    mkdirSync(root, { recursive: true });
    expect(() => prepareNodePtyPackage(root, { platform: 'linux', arch: 'x64' }))
      .toThrow('has no native module');
  });
});
