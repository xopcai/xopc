import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { larkAdapter } from '../adapters/lark.js';
import { cliContextPath, resolveCliArtifact, startCliProcess } from '../process.js';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'xopc-cli-test-')); vi.stubEnv('XOPC_STATE_DIR', directory); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe('managed CLI process', () => {
  it('passes literal arguments and excludes unrelated secrets', async () => {
    vi.stubEnv('UNRELATED_SECRET', 'hidden');
    const arg = '$(echo unsafe); "x"';
    const handle = await startCliProcess({ adapter: larkAdapter, executable: process.execPath, contextId: 'literal', args: ['-e', 'console.log(JSON.stringify({arg:process.argv[1], secret:process.env.UNRELATED_SECRET}))', arg] });
    const result = await handle.completion;
    expect(JSON.parse(result.stdout)).toEqual({ arg });
    expect(result.exitCode).toBe(0);
  });
  it('terminates timed out processes and bounds output', async () => {
    const pending = await startCliProcess({ adapter: larkAdapter, executable: process.execPath, contextId: 'timeout', args: ['-e', 'setInterval(()=>{},100)'], timeoutMs: 50 });
    expect((await pending.completion).timedOut).toBe(true);
    const noisy = await startCliProcess({ adapter: larkAdapter, executable: process.execPath, contextId: 'noise', args: ['-e', 'console.log("x".repeat(2000))'], maxOutputBytes: 100 });
    expect((await noisy.completion).outputTruncated).toBe(true);
  });
  it('rejects traversal context and artifacts escaping through symlinks', async () => {
    expect(() => cliContextPath('../outside')).toThrow();
    const handle = await startCliProcess({ adapter: larkAdapter, executable: process.execPath, contextId: 'files', args: ['-e', ''] });
    await handle.completion;
    const outside = join(directory, 'outside'); await writeFile(outside, 'private');
    const link = join(cliContextPath('files'), 'files', 'link'); await symlink(outside, link);
    await expect(resolveCliArtifact('files', link)).rejects.toThrow('outside');
  });
});
