import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CUA_MAC_NATIVE_FILES, prepareCuaSdkRuntime } from '../prepare-cua-sdk.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(arch: string) {
  const root = mkdtempSync(join(tmpdir(), 'xopc-cua-sdk-test-'));
  roots.push(root);
  const dir = join(root, 'node_modules/@trycua', `cua-driver-darwin-${arch}`);
  mkdirSync(dir, { recursive: true });
  for (const name of CUA_MAC_NATIVE_FILES) {
    writeFileSync(join(dir, name), 'universal');
    chmodSync(join(dir, name), 0o755);
  }
  return { root, dir };
}

describe('prepareCuaSdkRuntime', () => {
  it.each([['arm64', 'arm64'], ['x64', 'x86_64']])('keeps only %s without changing pnpm store hard links', (arch, slice) => {
    const { root, dir } = fixture(arch);
    for (const name of CUA_MAC_NATIVE_FILES) linkSync(join(dir, name), join(root, name));
    const runLipo = vi.fn((_command: string, args: string[]) => {
      if (args[0] === '-archs') return { status: 0, stdout: 'x86_64 arm64\n' };
      expect(args.slice(1, 4)).toEqual(['-thin', slice, '-output']);
      writeFileSync(args[4]!, `thin:${slice}`);
      return { status: 0 };
    });
    prepareCuaSdkRuntime(root, { platform: 'darwin', arch }, runLipo);
    for (const name of CUA_MAC_NATIVE_FILES) {
      expect(readFileSync(join(dir, name), 'utf8')).toBe(`thin:${slice}`);
      expect(readFileSync(join(root, name), 'utf8')).toBe('universal');
      expect(statSync(join(dir, name)).mode & 0o777).toBe(0o755);
    }
    expect(runLipo).toHaveBeenCalledTimes(4);
    expect(readdirSync(dir).sort()).toEqual([...CUA_MAC_NATIVE_FILES].sort());
  });

  it('accepts already thin target files without rewriting them', () => {
    const { root, dir } = fixture('arm64');
    const runLipo = vi.fn(() => ({ status: 0, stdout: 'arm64\n' }));
    prepareCuaSdkRuntime(root, { platform: 'darwin', arch: 'arm64' }, runLipo);
    expect(runLipo).toHaveBeenCalledTimes(2);
    expect(readFileSync(join(dir, CUA_MAC_NATIVE_FILES[0]), 'utf8')).toBe('universal');
  });

  it.each(['linux', 'win32'])('leaves %s native packages unchanged', platform => {
    const runLipo = vi.fn();
    prepareCuaSdkRuntime('/unused', { platform, arch: 'x64' }, runLipo);
    expect(runLipo).not.toHaveBeenCalled();
  });

  it('rejects a missing target slice', () => {
    const { root } = fixture('arm64');
    expect(() => prepareCuaSdkRuntime(root, { platform: 'darwin', arch: 'arm64' }, () => ({ status: 0, stdout: 'x86_64\n' })))
      .toThrow('missing the arm64 slice');
  });

  it('preserves the input and removes temporary files when thinning fails', () => {
    const { root, dir } = fixture('arm64');
    const runLipo = (_command: string, args: string[]) => args[0] === '-archs'
      ? { status: 0, stdout: 'arm64 x86_64' } : { status: 1, stderr: 'invalid Mach-O' };
    expect(() => prepareCuaSdkRuntime(root, { platform: 'darwin', arch: 'arm64' }, runLipo)).toThrow('invalid Mach-O');
    expect(readFileSync(join(dir, CUA_MAC_NATIVE_FILES[0]), 'utf8')).toBe('universal');
    expect(readdirSync(dir).sort()).toEqual([...CUA_MAC_NATIVE_FILES].sort());
  });

  it('rejects unsupported architectures and missing native packages', () => {
    expect(() => prepareCuaSdkRuntime('/unused', { platform: 'darwin', arch: 'ia32' })).toThrow('Unsupported');
    const { root } = fixture('arm64');
    expect(() => prepareCuaSdkRuntime(root, { platform: 'darwin', arch: 'x64' })).toThrow('ENOENT');
  });
});
