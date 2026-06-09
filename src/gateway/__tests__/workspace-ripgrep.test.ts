import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isAsarBundledPath,
  isRunnableRipgrepPath,
  resetRipgrepBinaryCacheForTests,
  runRipgrepListFiles,
} from '../workspace-ripgrep.js';

describe('workspace-ripgrep', () => {
  afterEach(() => {
    resetRipgrepBinaryCacheForTests();
    vi.unstubAllEnvs();
  });

  it('isAsarBundledPath detects app.asar paths', () => {
    expect(isAsarBundledPath('/Applications/xopc.app/Contents/Resources/app.asar/node_modules/@vscode/ripgrep/bin/rg')).toBe(true);
    expect(isAsarBundledPath('/usr/local/bin/rg')).toBe(false);
  });

  it('isRunnableRipgrepPath rejects asar paths even when existsSync would pass', () => {
    const asarRg = '/fake/app.asar/node_modules/@vscode/ripgrep/bin/rg';
    expect(isRunnableRipgrepPath(asarRg)).toBe(false);
  });

  it('isRunnableRipgrepPath accepts a real file on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-rg-test-'));
    const rgStub = join(dir, 'rg');
    writeFileSync(rgStub, '#!/bin/sh\n');
    expect(isRunnableRipgrepPath(rgStub)).toBe(true);
  });

  it('runRipgrepListFiles returns [] instead of rejecting when spawn throws ENOTDIR', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-rg-ws-'));
    const fakeRgDir = join(dir, 'rg-bin');
    mkdirSync(fakeRgDir);
    vi.stubEnv('XOPC_RIPGREP_BIN', fakeRgDir);
    await expect(runRipgrepListFiles(dir)).resolves.toEqual([]);
  });

  it('runRipgrepListFiles uses XOPC_RIPGREP_BIN when set to a real binary', async () => {
    const packagedRg = '/Applications/xopc.app/Contents/Resources/bin/rg';
    if (!existsSync(packagedRg)) {
      return;
    }
    vi.stubEnv('XOPC_RIPGREP_BIN', packagedRg);
    const dir = mkdtempSync(join(tmpdir(), 'xopc-rg-ws-'));
    writeFileSync(join(dir, 'hello.txt'), 'hi');
    const files = await runRipgrepListFiles(dir);
    expect(files.some((f) => f.replace(/^\.\//, '') === 'hello.txt')).toBe(true);
  });
});
