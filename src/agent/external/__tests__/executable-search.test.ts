import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  collectFallbackSearchDirs,
  collectHostExecutableCandidates,
  findHostExecutable,
} from '../executable-search.js';
import {
  detectAllExternalAgentRuntimesFast,
  invalidateExternalRuntimeProbeCache,
  probeAllExternalAgentRuntimesCached,
} from '../registry.js';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeFakeExecutable(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, name);
  writeFileSync(filePath, '#!/bin/sh\necho ok\n', 'utf8');
  if (process.platform !== 'win32') chmodSync(filePath, 0o755);
  return filePath;
}

afterEach(() => {
  invalidateExternalRuntimeProbeCache();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('host executable search', () => {
  it('finds executables in fallback user directories when PATH is minimal', () => {
    const home = makeTempDir('xopc-exec-home-');
    const binName = process.platform === 'win32' ? 'agy.cmd' : 'agy';
    const localBin = join(home, '.local', 'bin');
    const created = makeFakeExecutable(localBin, binName);

    const resolved = findHostExecutable({
      names: ['agy', 'antigravity'],
      env: { PATH: '/nonexistent-dir' },
      home,
    });

    expect(resolved).toBe(created);
  });

  it('prefers explicit PATH entries before extra and fallback directories', () => {
    const home = makeTempDir('xopc-exec-order-');
    const binName = process.platform === 'win32' ? 'codex.cmd' : 'codex';
    const pathBinDir = join(home, 'custom-path');
    const fallbackBinDir = join(home, '.local', 'bin');
    const pathBin = makeFakeExecutable(pathBinDir, binName);
    const fallbackBin = makeFakeExecutable(fallbackBinDir, binName);

    const candidates = collectHostExecutableCandidates({
      names: ['codex'],
      env: { PATH: pathBinDir },
      home,
    });

    expect(candidates.map((c) => c.path)).toEqual([pathBin, fallbackBin]);
  });

  it('respects explicit configuredPath exclusively without falling back to other dirs', () => {
    const home = makeTempDir('xopc-exec-explicit-');
    const binName = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    makeFakeExecutable(join(home, '.local', 'bin'), binName);

    const missing = findHostExecutable({
      names: ['claude'],
      configuredPath: join(home, 'missing-bin'),
      env: { PATH: '' },
      home,
    });
    expect(missing).toBeUndefined();
  });

  it('resolves nvm node bin directories in fallback search dirs on POSIX', () => {
    const home = makeTempDir('xopc-exec-nvm-');
    mkdirSync(join(home, '.nvm', 'versions', 'node', 'v22.14.0', 'bin'), { recursive: true });
    mkdirSync(join(home, '.nvm', 'alias'), { recursive: true });
    writeFileSync(join(home, '.nvm', 'alias', 'default'), '22.14.0\n', 'utf8');

    const dirs = collectFallbackSearchDirs({}, 'darwin', home);
    expect(dirs).toContain(join(home, '.nvm', 'versions', 'node', 'v22.14.0', 'bin'));
    expect(dirs).toContain('/opt/homebrew/bin');
    expect(dirs).toContain(join(home, '.local', 'bin'));
  });

  it('collects Windows npm/pnpm/local bin fallback directories on win32', () => {
    const dirs = collectFallbackSearchDirs(
      { APPDATA: 'C:\\Users\\demo\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\demo\\AppData\\Local', USERPROFILE: 'C:\\Users\\demo' },
      'win32',
      'C:\\Users\\demo',
    );
    expect(dirs.some((d) => d.includes('npm'))).toBe(true);
    expect(dirs.some((d) => d.includes('pnpm'))).toBe(true);
  });

  it('returns fast detections for all built-in drivers without throwing', () => {
    const fast = detectAllExternalAgentRuntimesFast();
    expect(fast.map((entry) => entry.kind)).toEqual(['codex', 'agy', 'claude']);
    for (const entry of fast) {
      expect(typeof entry.installed).toBe('boolean');
      expect(typeof entry.checkedAt).toBe('number');
    }
  });

  it('isolates missing binaries during cached full probe using explicit missing env overrides', async () => {
    const root = makeTempDir('xopc-probe-missing-');
    const prevCodex = process.env.XOPC_CODEX_BIN;
    const prevAgy = process.env.XOPC_AGY_BIN;
    const prevClaude = process.env.XOPC_CLAUDE_BIN;
    process.env.XOPC_CODEX_BIN = join(root, 'missing-codex');
    process.env.XOPC_AGY_BIN = join(root, 'missing-agy');
    process.env.XOPC_CLAUDE_BIN = join(root, 'missing-claude');
    try {
      const results = await probeAllExternalAgentRuntimesCached({ forceRefresh: true, timeoutMs: 3_000 });
      expect(results).toHaveLength(3);
      for (const result of results) {
        expect(result.installed).toBe(false);
        expect(result.status).toBe('not_installed');
      }
      // Second call hits cache and preserves checkedAt timestamp.
      const cached = await probeAllExternalAgentRuntimesCached({ forceRefresh: false, timeoutMs: 3_000 });
      expect(cached.map((r) => r.checkedAt)).toEqual(results.map((r) => r.checkedAt));
    } finally {
      if (prevCodex === undefined) delete process.env.XOPC_CODEX_BIN; else process.env.XOPC_CODEX_BIN = prevCodex;
      if (prevAgy === undefined) delete process.env.XOPC_AGY_BIN; else process.env.XOPC_AGY_BIN = prevAgy;
      if (prevClaude === undefined) delete process.env.XOPC_CLAUDE_BIN; else process.env.XOPC_CLAUDE_BIN = prevClaude;
    }
  });

  it('finds executable by bare name when present in PATH with multiple segments', () => {
    const dirA = makeTempDir('xopc-path-a-');
    const dirB = makeTempDir('xopc-path-b-');
    const binName = process.platform === 'win32' ? 'custom-cli.cmd' : 'custom-cli';
    const created = makeFakeExecutable(dirB, binName);

    const found = findHostExecutable({
      names: ['custom-cli'],
      env: { PATH: [dirA, dirB].join(delimiter) },
      includeFallbackDirs: false,
    });
    expect(found).toBe(created);
  });
});
