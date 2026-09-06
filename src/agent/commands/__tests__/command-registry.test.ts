import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { CommandRegistry, commandTimeout } from '../command-registry.js';

it('shares wait/stdin/cancel ownership and recovers durable terminal receipts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'commands-'));
  const registry = new CommandRegistry(root);
  try {
    const started = await registry.start({ owner: 'a', command: 'node -e "process.stdin.pipe(process.stdout)"', cwd: root, env: process.env, timeoutMs: 5000 });
    expect(registry.get('other', started.id)).toBeUndefined();
    expect(registry.write('other', started.id, 'no')).toBe(false);
    expect(registry.write('a', started.id, 'hello\n', true)).toBe(true);
    const done = await registry.wait('a', started.id, 5000);
    expect(done).toMatchObject({ status: 'success', stdout: 'hello\n' });
    expect(await readFile(done!.logPath, 'utf8')).toBe('hello\n');
    expect(new CommandRegistry(root).get('a', started.id)?.status).toBe('success');
    expect(commandTimeout(undefined)).toBe(1800000);
    expect(commandTimeout(999999999)).toBe(14400000);
    const controller = new AbortController(); controller.abort();
    await expect(registry.start({ owner: 'a', command: 'echo forbidden', cwd: root, env: {}, timeoutMs: 1000, signal: controller.signal })).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
