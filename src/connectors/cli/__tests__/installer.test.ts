import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runProcess } from '../../../process/run-process.js';
import { larkAdapter } from '../adapters/lark.js';
import { cliExecutablePath, installCli, verifyInstalledCli } from '../installer.js';
import type { CliAdapter } from '../types.js';

let directory: string;
let adapter: CliAdapter;
let binary: Buffer;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cli-install-')); vi.stubEnv('XOPC_STATE_DIR', directory);
  binary = Buffer.from('#!/bin/sh\n# UTF-8 integrity: 中文\nprintf "1.0.0\\n"\n');
  await writeFile(join(directory, 'fixture-cli'), binary);
  const archive = join(directory, 'fixture.tgz');
  const compressed = await runProcess({ program: 'tar', args: ['-czf', archive, '-C', directory, 'fixture-cli'] });
  expect(compressed.exitCode).toBe(0);
  const bytes = await readFile(archive);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(bytes));
  adapter = { ...larkAdapter, id: 'install-test', executable: 'fixture-cli', binaryVersion: '1.0.0', distributions: {
    [`${process.platform}-${process.arch}`]: { url: 'https://registry.npmjs.org/fixture.tgz', integrity: `sha256-${createHash('sha256').update(bytes).digest('hex')}`, archiveEntry: 'fixture-cli' },
  } };
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe('managed CLI installation', () => {
  it('extracts exact bytes and coalesces concurrent installations', async () => {
    const [first, second] = await Promise.all([installCli(adapter), installCli(adapter)]);
    expect(first).toBe(second); expect(await readFile(first)).toEqual(binary);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await verifyInstalledCli(adapter)).toBe(first);
    expect(await installCli(adapter)).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['missing', 'modified', 'not-executable'])('recovers a %s cached CLI on explicit installation', async state => {
    const executable = await installCli(adapter);
    if (state === 'missing') await rm(executable);
    else if (state === 'modified') await writeFile(executable, 'modified');
    else await chmod(executable, 0o600);
    await expect(verifyInstalledCli(adapter)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await installCli(adapter)).toBe(executable);
    expect(await readFile(executable)).toEqual(binary);
    expect(await verifyInstalledCli(adapter)).toBe(executable);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('keeps the old pinned version usable when a new distribution is invalid', async () => {
    await installCli(adapter);
    const newer = { ...adapter, binaryVersion: '2.0.0', distributions: { [`${process.platform}-${process.arch}`]: { ...adapter.distributions[`${process.platform}-${process.arch}`]!, integrity: `sha256-${'0'.repeat(64)}` } } };
    await expect(installCli(newer)).rejects.toThrow('integrity');
    expect(await verifyInstalledCli(adapter)).toBe(cliExecutablePath(adapter));
    await expect(readFile(cliExecutablePath(newer))).rejects.toThrow();
    await writeFile(cliExecutablePath(adapter), 'modified');
    await expect(verifyInstalledCli(adapter)).rejects.toThrow('integrity');
  });
});
