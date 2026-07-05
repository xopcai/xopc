import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CommandRunner } from '../run-command.js';
import {
  detectGlobalInstallManagerForRoot,
  globalInstallArgs,
  globalInstallFallbackArgs,
  joinGlobalPackagePath,
  resolveGlobalInstallSpec,
  resolveGlobalRoot,
  XOPC_PACKAGE_NAME,
} from '../update-global.js';

function resolveTestNpmCommand(): string {
  const npmCandidate = path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
  return fsSync.existsSync(npmCandidate) ? npmCandidate : 'npm';
}

function createNpmRootRunner(defaultNpmRoot: string): CommandRunner {
  const npmCommand = resolveTestNpmCommand();
  return async (argv) => {
    if (argv[0] === npmCommand && argv[1] === 'root') {
      return { stdout: `${defaultNpmRoot}\n`, stderr: '', code: 0 };
    }
    if (argv[0] === 'pnpm') {
      return { stdout: '', stderr: '', code: 1 };
    }
    return { stdout: '', stderr: '', code: 1 };
  };
}

describe('update-global', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function makeTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xopc-update-global-'));
    tempDirs.push(dir);
    return dir;
  }

  it('joinGlobalPackagePath handles scoped package name', () => {
    expect(joinGlobalPackagePath('/tmp/npm-root')).toBe(path.join('/tmp/npm-root', XOPC_PACKAGE_NAME));
  });

  it('resolveGlobalInstallSpec builds scoped version spec', () => {
    expect(resolveGlobalInstallSpec({ version: '1.2.3' })).toBe(`${XOPC_PACKAGE_NAME}@1.2.3`);
  });

  it('globalInstallArgs uses npm install with quiet flags', () => {
    const npmCommand = resolveTestNpmCommand();
    expect(globalInstallArgs('npm', `${XOPC_PACKAGE_NAME}@1.0.0`)).toEqual([
      npmCommand,
      'install',
      '-g',
      `${XOPC_PACKAGE_NAME}@1.0.0`,
      '--no-fund',
      '--no-audit',
      '--loglevel=error',
    ]);
  });

  it('globalInstallArgs resolves npm from process.execPath when pkgRoot is absent', () => {
    const npmCandidate = resolveTestNpmCommand();
    if (!fsSync.existsSync(npmCandidate)) return;

    const argv = globalInstallArgs('npm', `${XOPC_PACKAGE_NAME}@1.0.0`, null);
    expect(argv[0]).toBe(npmCandidate);
    expect(argv.slice(1, 4)).toEqual(['install', '-g', `${XOPC_PACKAGE_NAME}@1.0.0`]);
  });

  it('globalInstallFallbackArgs adds omit=optional for npm only', () => {
    expect(globalInstallFallbackArgs('npm', `${XOPC_PACKAGE_NAME}@1.0.0`)).toContain('--omit=optional');
    expect(globalInstallFallbackArgs('pnpm', `${XOPC_PACKAGE_NAME}@1.0.0`)).toBeNull();
  });

  it('detectGlobalInstallManagerForRoot matches npm global layout', async () => {
    const globalRoot = await makeTempDir();
    const pkgRoot = joinGlobalPackagePath(globalRoot);
    await fs.mkdir(path.dirname(pkgRoot), { recursive: true });
    await fs.mkdir(pkgRoot, { recursive: true });
    await fs.writeFile(
      path.join(pkgRoot, 'package.json'),
      JSON.stringify({ name: XOPC_PACKAGE_NAME, version: '0.0.1' }),
      'utf-8',
    );

    const runCommand = createNpmRootRunner(globalRoot);
    await expect(detectGlobalInstallManagerForRoot(runCommand, pkgRoot, 5000)).resolves.toBe('npm');
    await expect(resolveGlobalRoot('npm', runCommand, 5000)).resolves.toBe(globalRoot);
  });

});
