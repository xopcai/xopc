import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveCodebaseMemoryBinary } from '../binary.js';

describe('resolveCodebaseMemoryBinary', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('prefers an explicit executable path', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-cbm-'));
    roots.push(root);
    const binary = join(root, process.platform === 'win32' ? 'cbm.exe' : 'cbm');
    writeFileSync(binary, 'test');
    if (process.platform !== 'win32') chmodSync(binary, 0o755);

    expect(resolveCodebaseMemoryBinary(binary)).toBe(realpathSync(binary));
  });
});
