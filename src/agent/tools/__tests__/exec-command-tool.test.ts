import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { createExecCommandTool } from '../exec-command.js';

describe('exec_command tool', () => {
  it.skipIf(process.platform === 'win32')('rejects malformed POSIX syntax before any earlier write and supports explicit bash', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-exec-preflight-'));
    try {
      const tool = createExecCommandTool(workspace);
      const failure = await tool.execute('preflight', { cmd: 'printf changed > report.txt\ndiff <(printf old) <(printf new)' });
      expect(failure.details.status).toBe('failed');
      expect(failure.details.failureHint).toContain('nothing was executed');
      await expect(access(join(workspace, 'report.txt'))).rejects.toThrow();
      const success = await tool.execute('explicit-bash', { cmd: "bash -c 'cat <(printf valid)'" });
      expect(success.details.stdout).toBe('valid');
      const portable = await tool.execute('portable-write', { cmd: 'printf changed > report.txt' });
      expect(portable.details.status).toBe('success');
      expect(await readFile(join(workspace, 'report.txt'), 'utf8')).toBe('changed');
    } finally { await rm(workspace, { recursive: true, force: true }); }
  });
  it('retains destructive-command rejection with a non-destructive recovery', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-exec-blocked-'));
    try {
      const result = await createExecCommandTool(workspace).execute('blocked-cleanup', { cmd: 'OUT=out\nrm -rf "$OUT"\nmkdir -p "$OUT"' });
      expect(result.details.status).toBe('blocked');
      expect(JSON.stringify(result.content)).toContain('fresh output directory');
      expect(JSON.stringify(result.content)).toContain('Do not repeat unchanged');
      await expect(access(join(workspace, 'out'))).rejects.toThrow();
    } finally { await rm(workspace, { recursive: true, force: true }); }
  });
  it('streams output deltas and returns structured command details', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-exec-'));
    try {
      const tool = createExecCommandTool(workspace);
      const updates: unknown[] = [];
      const node = JSON.stringify(process.execPath);
      const result = await tool.execute(
        'tc1',
        { cmd: `${node} -e "process.stdout.write('hello'); process.stderr.write('err')"`, timeoutMs: 10_000 },
        undefined,
        (update) => {
          updates.push(update.details);
        },
      );

      expect(result.details.exitCode).toBe(0);
      expect(result.details.status).toBe('success');
      expect(result.details.failureHint).toBeUndefined();
      expect(result.details.cwd).toContain(basename(workspace));
      expect(result.details.stdout).toBe('hello');
      expect(result.details.stderr).toBe('err');
      expect(result.details.aggregatedOutput).toContain('hello');
      expect(updates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'command_output_delta', stream: 'stdout', delta: 'hello' }),
          expect.objectContaining({ kind: 'command_output_delta', stream: 'stderr', delta: 'err' }),
        ]),
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('returns actionable failure hints for non-zero exits', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-exec-'));
    try {
      const tool = createExecCommandTool(workspace);
      const node = JSON.stringify(process.execPath);
      const result = await tool.execute('tc2', {
        cmd: `${node} -e "process.stderr.write('bad'); process.exit(7)"`,
        timeoutMs: 10_000,
      });

      expect(result.details.status).toBe('failed');
      expect(result.details.exitCode).toBe(7);
      expect(result.details.failureHint).toContain('Inspect stderr');
      expect((result.content[0] as { text: string }).text).toContain('Next action:');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('explains a shell syntax failure without silently changing the shell', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-exec-shell-'));
    try {
      const tool = createExecCommandTool(workspace);
      const result = await tool.execute('shell-syntax', { cmd: 'cat <(printf hello)', timeoutMs: 10_000 });
      expect(result.details.exitCode).not.toBe(0);
      expect(result.details.timedOut).toBe(false);
      expect(result.details.failureHint).toContain('POSIX sh');
    } finally { await rm(workspace, { recursive: true, force: true }); }
  });

  it('uses the prepared runtime environment', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-exec-'));
    try {
      const tool = createExecCommandTool(workspace, {
        prepareEnv: async (env) => ({ ...env, XOPC_RUNTIME_TEST: 'managed' }),
      });
      const node = JSON.stringify(process.execPath);
      const result = await tool.execute('tc3', {
        cmd: `${node} -e "process.stdout.write(process.env.XOPC_RUNTIME_TEST ?? '')"`,
        timeoutMs: 10_000,
      });

      expect(result.details.exitCode).toBe(0);
      expect(result.details.stdout).toBe('managed');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('persists declared command outputs in the same tool result', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-exec-'));
    try {
      const tool = createExecCommandTool(workspace);
      const node = JSON.stringify(process.execPath);
      const result = await tool.execute('tc-output', {
        cmd: `${node} -e "require('node:fs').writeFileSync('report.csv', 'a,b\\n1,2')"`,
        outputs: ['report.csv'],
        timeoutMs: 10_000,
      });

      expect(result.details.status).toBe('success');
      expect(result.details.artifacts).toEqual([
        expect.objectContaining({
          title: 'report.csv',
          kind: 'spreadsheet',
          availability: 'available',
          location: 'artifact_store',
        }),
      ]);
      expect((result.content[0] as { text: string }).text).toContain('Artifacts: 1 published.');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('captures previously written deliverables with a successful standalone check, never after a failed check', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-exec-existing-'));
    try {
      await writeFile(join(workspace, 'report.md'), '# Verified result\n');
      await writeFile(join(workspace, 'verify.test.cjs'), 'const assert = require("node:assert/strict"); const fs = require("node:fs"); assert.match(fs.readFileSync("report.md", "utf8"), /Verified result/);');
      const tool = createExecCommandTool(workspace);
      const result = await tool.execute('existing-output', { cmd: 'node --test verify.test.cjs', outputs: ['report.md'] });
      expect(result.details.status).toBe('success');
      expect(result.details.artifacts).toEqual([expect.objectContaining({ title: 'report.md', availability: 'available', location: 'artifact_store' })]);
      expect(JSON.stringify(result.content)).toContain('report.md');
      expect(JSON.stringify(result.content)).toContain('available');
      expect(await readFile(join(workspace, 'report.md'), 'utf8')).toBe('# Verified result\n');
      await writeFile(join(workspace, 'verify.test.cjs'), 'require("node:assert/strict").fail("verification failed");');
      const failed = await tool.execute('failed-output', { cmd: 'node --test verify.test.cjs', outputs: ['report.md'] });
      expect(failed.details.status).toBe('failed');
      expect(failed.details.artifacts).toBeUndefined();
    } finally { await rm(workspace, { recursive: true, force: true }); }
  });

  it('bounds captured output before constructing the result', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-exec-'));
    try {
      const tool = createExecCommandTool(workspace);
      const node = JSON.stringify(process.execPath);
      const result = await tool.execute('tc4', {
        cmd: `${node} -e "process.stdout.write('x'.repeat(200000))"`,
        timeoutMs: 10_000,
        maxOutputChars: 10_000,
      });

      expect(result.details.status).toBe('success');
      expect(result.details.captureTruncated).toBe(true);
      expect(result.details.totalOutputBytes).toBe(200_000);
      expect(result.details.stdout.length).toBeLessThanOrEqual(10_000);
      expect(result.details.aggregatedOutput.length).toBeLessThanOrEqual(10_000);
      expect((result.content[0] as { text: string }).text).toContain('Earlier command output was discarded');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== 'win32')('kills descendant processes when the command times out', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-exec-'));
    try {
      const marker = join(workspace, 'orphan-marker');
      const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'alive'), 1500); setInterval(() => {}, 1000);`;
      const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' }); setInterval(() => {}, 1000);`;
      const tool = createExecCommandTool(workspace);
      const result = await tool.execute('tc5', {
        cmd: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(parent)}`,
        timeoutMs: 1_000,
      });

      expect(result.details.status).toBe('timed_out');
      await new Promise((resolve) => setTimeout(resolve, 700));
      await expect(import('node:fs/promises').then(({ access }) => access(marker))).rejects.toThrow();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});


describe('explicit verification reuse for requested outputs', () => {
  it('publishes from identical successful evidence without executing again, and rejects stale or failed evidence', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'xopc-check-reuse-'));
    const counter = join(tmpdir(), `xopc-check-counter-${Date.now()}`);
    try {
      execFileSync('git', ['init', '-q'], { cwd: workspace });
      await writeFile(join(workspace, 'result.json'), '{"ok":true}');
      await writeFile(join(workspace, 'check.test.mjs'), `import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const counter=${JSON.stringify(counter)};
const count=existsSync(counter)?Number(readFileSync(counter,'utf8')):0;
writeFileSync(counter,String(count+1));
test('ok',()=>{if(existsSync('fail'))throw Error('expected failure');});
`);
      const tool = createExecCommandTool(workspace);
      const first = await tool.execute('first-check', { cmd: 'node --test check.test.mjs' });
      expect(first.details.exitCode).toBe(0);
      const reuse = await tool.execute('capture', { cmd: 'node --test check.test.mjs', outputs: ['result.json'], reuseVerification: true });
      expect(reuse.details).toMatchObject({ executionPerformed: false, reusedFromToolCallId: 'first-check', exitCode: 0 });
      expect(JSON.stringify(reuse.content)).toContain('No command executed');
      expect(await readFile(counter,'utf8')).toBe('1');
      await writeFile(join(workspace, 'result.json'), '{"ok":false}');
      await expect(tool.execute('stale', { cmd: 'node --test check.test.mjs', outputs: ['result.json'], reuseVerification: true })).rejects.toThrow('no reusable');
      expect(await readFile(counter,'utf8')).toBe('1');
      await tool.execute('fresh', { cmd: 'node --test check.test.mjs' });
      expect(await readFile(counter,'utf8')).toBe('2');
      await writeFile(join(workspace, 'fail'), '1');
      const failed = await tool.execute('failed', { cmd: 'node --test check.test.mjs' });
      expect(failed.details.exitCode).not.toBe(0);
      await rm(join(workspace, 'fail'));
      await expect(tool.execute('after-failure', { cmd: 'node --test check.test.mjs', outputs: ['result.json'], reuseVerification: true })).rejects.toThrow('no reusable');
    } finally { await rm(workspace, { recursive:true,force:true }); await rm(counter,{force:true}); }
  });
});
