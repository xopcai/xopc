import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withInstallLock } from '../install-lock.js';

describe('runtime install lock', () => {
  it('immediately recovers a lock owned by a dead process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xopc-runtime-lock-'));
    const lockPath = join(root, 'locks', 'node.lock');
    try {
      await mkdir(dirname(lockPath), { recursive: true });
      await writeFile(lockPath, JSON.stringify({ pid: 2_147_483_647, createdAt: Date.now() }));
      await expect(withInstallLock(lockPath, {}, async () => 'ready')).resolves.toBe('ready');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('allows lock waiting to be cancelled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xopc-runtime-lock-'));
    const lockPath = join(root, 'locks', 'node.lock');
    const controller = new AbortController();
    try {
      await mkdir(dirname(lockPath), { recursive: true });
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      setTimeout(() => controller.abort(new Error('cancelled')), 10);
      await expect(withInstallLock(lockPath, {}, async () => 'ready', controller.signal))
        .rejects.toThrow('cancelled');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
