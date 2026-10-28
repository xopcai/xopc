import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { ExternalIntakeQueue, intakePaths, INTAKE_MAX_BYTES } from '../external-intake.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'xopc-intake-')); roots.push(root);
  return { root, queue: new ExternalIntakeQueue(join(root, 'queue')) };
}

it('captures original bytes, recovers multiple batches after restart and binds one target', async () => {
  const { root, queue } = await setup();
  const source = join(root, 'with spaces.png');
  await writeFile(source, new Uint8Array([0, 1, 255]));
  await queue.receive([source]); await writeFile(source, 'changed'); await queue.receive([source]);
  const restarted = new ExternalIntakeQueue(join(root, 'queue'));
  const batches = await restarted.list(); expect(batches).toHaveLength(2);
  const first = batches[0]!;
  expect(await restarted.read(first.id, first.items[0]!.id)).toBe('AAH/');
  await expect(restarted.read(first.id, '../../secret')).rejects.toThrow('Unknown attachment');
  await restarted.target(first.id, 'a'.repeat(64), '12345678-1234-4234-8234-123456789abc');
  await expect(restarted.target(first.id, 'b'.repeat(64), '12345678-1234-4234-8234-123456789abc')).rejects.toThrow('another target');
  await expect(restarted.release(first.id, 'b'.repeat(64))).rejects.toThrow('another connection');
  await restarted.release(first.id, 'a'.repeat(64));
  expect((await restarted.list())[0]!.target).toBeUndefined();
  await restarted.remove(first.id);
  expect(await restarted.list()).toHaveLength(1);
});

it('reports unreadable, oversized, empty and directory inputs without dropping the batch', async () => {
  const { root, queue } = await setup();
  await writeFile(join(root, 'large.pdf'), Buffer.alloc(INTAKE_MAX_BYTES + 1));
  await writeFile(join(root, 'empty.txt'), '');
  await queue.receive([root, join(root, 'missing.txt'), join(root, 'large.pdf'), join(root, 'empty.txt')]);
  const [batch] = await queue.list();
  expect(batch!.items).toHaveLength(4);
  expect(batch!.items.every(item => Boolean(item.error))).toBe(true);
  await expect(queue.remove('../queue')).rejects.toThrow('Invalid intake ID');
});

it('parses launch paths relative to the second-instance working directory and ignores flags and URLs', () => {
  expect(intakePaths(['--inspect', '--config=secret.json', 'xopc://chat/a', 'relative file.pdf', '/tmp/a.png'], '/tmp/work'))
    .toEqual(['/tmp/work/relative file.pdf', '/tmp/a.png']);
});
