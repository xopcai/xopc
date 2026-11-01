import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid benchmark test cleanup path');
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Windows native benchmark plan', () => {
  it('lists its fixed task matrix without launching a desktop or requesting a model', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/benchmark-computer-windows.mts', '--list'],
      { encoding: 'utf8', timeout: 15000 });
    expect(result.status, result.stderr).toBe(0);
    const manifest = JSON.parse(result.stdout);
    expect(manifest.frameworks).toEqual(['winforms', 'wpf']);
    expect(manifest.tasks.map((task: { id: string }) => task.id)).toEqual([
      'replace', 'append', 'deduplicate', 'protected', 'stale', 'owner', 'released', 'keyboard',
    ]);
  });
  it.skipIf(process.platform !== 'win32')('refuses existing evidence before any driver or fixture is started', () => {
    const directory = mkdtempSync(join(tmpdir(), 'computer-benchmark-')); directories.push(directory);
    const marker = join(directory, 'preserved.json'); writeFileSync(marker, 'original evidence');
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/benchmark-computer-windows.mts', '--output', directory],
      { encoding: 'utf8', timeout: 15000 });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('EEXIST');
    expect(readFileSync(marker, 'utf8')).toBe('original evidence');
    expect(existsSync(join(directory, 'manifest.json'))).toBe(false);
  });
  it.skipIf(process.platform !== 'win32')('rejects an invalid repetition budget before creating evidence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'computer-benchmark-')); directories.push(directory);
    const output = join(directory, 'not-created');
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/benchmark-computer-windows.mts', '--repetitions', '0', '--output', output],
      { encoding: 'utf8', timeout: 15000 });
    expect(result.status).not.toBe(0); expect(existsSync(output)).toBe(false);
  });
});
