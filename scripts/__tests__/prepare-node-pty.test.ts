import { accessSync, constants, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
    mkdirSync(join(root, 'prebuilds/win32-x64'), { recursive: true });
    writeFileSync(join(root, 'prebuilds/win32-x64/pty.node'), 'unused');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/index.ts'), 'unused');
    mkdirSync(join(root, 'lib'), { recursive: true });
    writeFileSync(join(root, 'lib/index.js'), 'runtime');
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(join(root, 'LICENSE'), 'fixture');

    prepareNodePtyPackage(root, { platform: 'darwin', arch: 'arm64' });

    expect(() => accessSync(join(prebuild, 'spawn-helper'), constants.X_OK)).not.toThrow();
    expect(existsSync(join(root, 'prebuilds/win32-x64'))).toBe(false);
    expect(existsSync(join(root, 'src'))).toBe(false);
    expect(existsSync(join(root, 'lib/index.js'))).toBe(true);
  });

  it('keeps only the target Windows runtime and removes debug symbols', () => {
    const root = join(tmpdir(), `xopc-node-pty-windows-${process.pid}-${Date.now()}`);
    roots.push(root);
    const target = join(root, 'prebuilds/win32-x64');
    mkdirSync(join(target, 'conpty'), { recursive: true });
    writeFileSync(join(target, 'pty.node'), 'fixture');
    writeFileSync(join(target, 'conpty.node'), 'fixture');
    writeFileSync(join(target, 'pty.pdb'), 'debug');
    writeFileSync(join(target, 'conpty/OpenConsole.exe'), 'runtime');
    mkdirSync(join(root, 'lib'), { recursive: true });
    writeFileSync(join(root, 'lib/index.js'), 'runtime');
    writeFileSync(join(root, 'package.json'), '{}');

    prepareNodePtyPackage(root, { platform: 'win32', arch: 'x64' });

    expect(existsSync(join(target, 'pty.node'))).toBe(true);
    expect(existsSync(join(target, 'conpty/OpenConsole.exe'))).toBe(true);
    expect(existsSync(join(target, 'pty.pdb'))).toBe(false);
  });

  it('keeps a macOS release helper when the native module is prebuilt', () => {
    const root = join(tmpdir(), `xopc-node-pty-helper-${process.pid}-${Date.now()}`);
    roots.push(root);
    const prebuild = join(root, 'prebuilds/darwin-arm64');
    const release = join(root, 'build/Release');
    mkdirSync(prebuild, { recursive: true });
    mkdirSync(release, { recursive: true });
    mkdirSync(join(root, 'lib'), { recursive: true });
    writeFileSync(join(prebuild, 'pty.node'), 'fixture');
    writeFileSync(join(release, 'spawn-helper'), 'fixture', { mode: 0o644 });
    writeFileSync(join(root, 'lib/index.js'), 'runtime');
    writeFileSync(join(root, 'package.json'), '{}');

    prepareNodePtyPackage(root, { platform: 'darwin', arch: 'arm64' });

    expect(existsSync(join(release, 'spawn-helper'))).toBe(true);
    expect(() => accessSync(join(release, 'spawn-helper'), constants.X_OK)).not.toThrow();
  });

  it('rejects a package without a target native module', () => {
    const root = join(tmpdir(), `xopc-node-pty-missing-${process.pid}-${Date.now()}`);
    roots.push(root);
    mkdirSync(root, { recursive: true });
    expect(() => prepareNodePtyPackage(root, { platform: 'linux', arch: 'x64' }))
      .toThrow('has no native module');
  });
});
