import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { expect, it } from 'vitest';

import { useTestDatabase } from '../../../storage/sqlite/__tests__/test-database.js';
import { CommandRegistry } from '../command-registry.js';

useTestDatabase();
const image = process.env.XOPC_TEST_SANDBOX_IMAGE;

// Opt in with an already-installed, digest-pinned Node image. Never pulls an image.
it.skipIf(!image)('enforces real Docker file, credential and network boundaries and cancellation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-docker-integration-'));
  const registry = new CommandRegistry(join(root, 'logs'));
  const owner = 'docker-integration';
  try {
    await writeFile(join(root, '.env'), 'synthetic-private-value');
    const script = `
      const fs = require('node:fs');
      const assert = require('node:assert/strict');
      const os = require('node:os');
      assert.notEqual(process.getuid(), 0);
      assert.equal(process.env.OPENAI_API_KEY, undefined);
      assert.equal(fs.readFileSync('/workspace/.env', 'utf8'), '');
      assert.throws(() => fs.writeFileSync('/workspace/.env', 'overwrite'));
      assert.throws(() => fs.writeFileSync('/workspace/new.txt', 'overwrite'));
      assert.throws(() => fs.writeFileSync('/rootfs-test', 'overwrite'));
      assert(Object.keys(os.networkInterfaces()).every(name => name === 'lo'));
      fs.writeFileSync('/tmp/allowed.txt', 'ok');
      console.log('boundaries-ok');
    `;
    await writeFile(join(root, 'probe.cjs'), script);
    const isolation = { mode: 'docker' as const, image: image! };
    const run = await registry.start({ owner, command: 'node probe.cjs', cwd: root, workspace: root,
      isolation, env: { ...process.env, OPENAI_API_KEY: 'synthetic-host-secret' }, timeoutMs: 30_000 });
    const result = await registry.wait(owner, run.id, 60_000);
    expect(result?.status, result?.stderr).toBe('success');
    expect(result?.stdout).toContain('boundaries-ok');
    expect(await readFile(join(root, '.env'), 'utf8')).toBe('synthetic-private-value');

    const writable = await registry.start({ owner, command: 'echo allowed > new.txt', cwd: root, workspace: root,
      isolation: { ...isolation, workspaceAccess: 'read-write' }, env: process.env, timeoutMs: 30_000 });
    expect((await registry.wait(owner, writable.id, 60_000))?.status).toBe('success');
    expect(await readFile(join(root, 'new.txt'), 'utf8')).toContain('allowed');

    await writeFile(join(root, 'wait.cjs'), "console.log('ready'); setInterval(() => {}, 1000);");
    const pending = await registry.start({ owner, command: 'node wait.cjs', cwd: root, workspace: root,
      isolation, env: process.env, timeoutMs: 30_000 });
    let waiting = await registry.wait(owner, pending.id, 1000);
    while (waiting?.status === 'running' && !waiting.stdout.includes('ready')) {
      waiting = await registry.wait(owner, pending.id, 1000);
    }
    expect(waiting?.stdout, waiting?.stderr).toContain('ready');
    const cancelled = await registry.cancel(owner, pending.id);
    expect(cancelled?.status, cancelled?.stderr).toBe('cancelled');
  } finally {
    registry.shutdown();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
