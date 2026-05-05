import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { writeTextAtomic } from '../write-file-atomic.js';

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
});
