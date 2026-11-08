import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { closeXopcDatabase } from '../../../storage/sqlite/connection.js';
import { setSessionInteractionPolicy } from '../../session/interaction-policy.js';
import { CommandRegistry } from '../command-registry.js';

let registry: CommandRegistry | undefined;
let root: string | undefined;
afterEach(async () => { registry?.shutdown(); closeXopcDatabase(); if (root) await rm(root, { recursive: true, force: true }); });

it('allocates a real PTY, accepts input, resizes, isolates owners and keeps the exit receipt', async () => {
  initializeTestAgentCatalog(); root = await mkdtemp(join(tmpdir(), 'xopc-pty-job-'));
  registry = new CommandRegistry(join(root, 'logs'));
  const job = await registry.start({ owner: 'terminal-A', command: "node -e \"console.log('tty='+process.stdin.isTTY);process.stdin.setRawMode(true);process.stdout.on('resize',()=>console.log('size='+process.stdout.columns));process.stdin.on('data',x=>{console.log('input='+x);process.exit(0)})\"", cwd: root, env: process.env, timeoutMs: 10000, tty: true });
  await expect.poll(() => registry!.get('terminal-A', job.id)?.aggregatedOutput).toContain('tty=true');
  expect(registry.resize('terminal-B', job.id, 90, 25)).toBe(false);
  expect(registry.write('terminal-B', job.id, 'foreign')).toBe(false);
  expect(registry.resize('terminal-A', job.id, 90, 25)).toBe(true);
  await expect.poll(() => registry!.get('terminal-A', job.id)?.aggregatedOutput).toContain('size=90');
  registry.write('terminal-A', job.id, 'hello');
  const completed = await registry.wait('terminal-A', job.id, 5000);
  expect(completed?.status).toBe('success'); expect(completed?.aggregatedOutput).toContain('input=hello');
  expect(new CommandRegistry(join(root, 'logs')).get('terminal-A', job.id)?.status).toBe('success');
});

it.skipIf(process.platform !== 'darwin')('enforces OS read-only and workspace-write boundaries for shell execution', async () => {
  initializeTestAgentCatalog(); root = await mkdtemp(join(tmpdir(), 'xopc-native-sandbox-'));
  const workspace = join(root, 'workspace'); const { mkdir } = await import('node:fs/promises'); await mkdir(workspace);
  registry = new CommandRegistry(join(root, 'logs'));
  setSessionInteractionPolicy('sandbox-A', { mode: 'default', access: 'read-only' });
  const blocked = await registry.start({ owner: 'sandbox-A', command: "touch forbidden.txt", cwd: workspace, workspace, env: process.env, timeoutMs: 5000 });
  expect((await registry.wait('sandbox-A', blocked.id, 5000))?.status).toBe('failed');
  setSessionInteractionPolicy('sandbox-A', { mode: 'default', access: 'configured', sandbox: 'workspace-write', network: false });
  const allowed = await registry.start({ owner: 'sandbox-A', command: "printf allowed > allowed.txt", cwd: workspace, workspace, env: process.env, timeoutMs: 5000 });
  expect((await registry.wait('sandbox-A', allowed.id, 5000))?.status).toBe('success');
  expect(await readFile(join(workspace, 'allowed.txt'), 'utf8')).toBe('allowed');
});
