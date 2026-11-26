import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { buildClaudeEnv } from '../drivers/claude/executable.js';
import { CodexAppServer } from '../drivers/codex/app-server.js';
import { closeRuntimeProcess } from '../runtime-process.js';

it.skipIf(process.platform === 'win32')('terminates a subprocess after its stdio process has exited', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-runtime-tree-'));
  const pidFile = join(root, 'worker.pid');
  let worker: number | undefined;
  try {
    const child = spawn(process.execPath, ['-e', `
      const { spawn } = require('node:child_process');
      const { writeFileSync } = require('node:fs');
      const worker = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: 'ignore' });
      writeFileSync(process.argv[1], String(worker.pid));
      process.exit(0);
    `, pidFile], { detached: true });
    const closed = once(child, 'close').then(() => {});
    await once(child, 'exit');
    worker = Number(await readFile(pidFile, 'utf8'));
    const live = () => {
      const status = spawnSync('ps', ['-o', 'stat=', '-p', String(worker)], { encoding: 'utf8' }).stdout.trim();
      return Boolean(status) && !status.startsWith('Z');
    };
    expect(live()).toBe(true);
    await closeRuntimeProcess(child, closed, 'fixture', true);
    expect(live()).toBe(false);
  } finally {
    if (worker) {
      try { process.kill(worker, 'SIGKILL'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
    await rm(root, { force: true, recursive: true });
  }
});

it.skipIf(process.platform === 'win32')('starts Codex by a custom binary name resolved on PATH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-codex-path-'));
  let server: CodexAppServer | undefined;
  try {
    await writeFile(join(root, 'review-codex'), `#!${process.execPath}
      const { createInterface } = require('node:readline');
      createInterface({ input: process.stdin }).on('line', line => {
        const { id } = JSON.parse(line);
        console.log(JSON.stringify({ id, result: { ready: true, inheritedGatewayCredential: !!process.env.XOPC_GATEWAY_TOKEN, providerConfigured: !!process.env.OPENAI_API_KEY, otherProviderConfigured: !!process.env.ANTHROPIC_API_KEY } }));
      });
    `, { mode: 0o700 });
    vi.stubEnv('PATH', [root, process.env.PATH].join(delimiter));
    vi.stubEnv('XOPC_GATEWAY_TOKEN', 'fixture-gateway');
    vi.stubEnv('OPENAI_API_KEY', 'fixture-codex');
    vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-claude');
    server = new CodexAppServer(tmpdir(), () => {}, () => {}, { binaryPath: 'review-codex' });
    await expect(server.request('initialize', {}, AbortSignal.timeout(3_000))).resolves.toEqual({ ready: true, inheritedGatewayCredential: false, providerConfigured: true, otherProviderConfigured: false });
  } finally {
    await server?.close();
    vi.unstubAllEnvs();
    await rm(root, { force: true, recursive: true });
  }
});

it('passes only the provider key selected by the Claude user profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-claude-auth-env-'));
  const settings = join(root, 'settings.json');
  try {
    vi.stubEnv('DEEPSEEK_API_KEY', 'fixture-provider-key');
    vi.stubEnv('OPENAI_API_KEY', 'fixture-other-provider-key');
    vi.stubEnv('XOPC_INTERNAL_API_KEY', 'fixture-private-key');
    await writeFile(settings, JSON.stringify({ apiKeyHelper: '/usr/bin/printenv DEEPSEEK_API_KEY' }));
    expect(buildClaudeEnv(root)).toMatchObject({ CLAUDE_CONFIG_DIR: root, DEEPSEEK_API_KEY: 'fixture-provider-key' });
    expect(buildClaudeEnv(root)).not.toHaveProperty('OPENAI_API_KEY');

    await writeFile(settings, JSON.stringify({ apiKeyHelper: '/usr/bin/printenv XOPC_INTERNAL_API_KEY' }));
    expect(buildClaudeEnv(root)).not.toHaveProperty('XOPC_INTERNAL_API_KEY');
    await writeFile(settings, JSON.stringify({ apiKeyHelper: 'printenv DEEPSEEK_API_KEY && true' }));
    expect(buildClaudeEnv(root)).not.toHaveProperty('DEEPSEEK_API_KEY');
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { force: true, recursive: true });
  }
});
