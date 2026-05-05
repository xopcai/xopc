import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { writeTextAtomic, writeTextAtomicSync } from '../write-file-atomic.js';

describe('writeTextAtomic', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'xopc-atomic-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes full content readable after complete', async () => {
    const path = join(dir, 'nested', 'out.txt');
    const payload = '{"hello":true}\n';
    await writeTextAtomic(path, payload);
    const read = await readFile(path, 'utf-8');
    expect(read).toBe(payload);
  });

  it('writeTextAtomicSync writes full content', () => {
    const path = join(dir, 'sync.json');
    const payload = '{"x":1}';
    writeTextAtomicSync(path, payload);
    const read = readFileSync(path, 'utf-8');
    expect(read).toBe(payload);
  });
});
