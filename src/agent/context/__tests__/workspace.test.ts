import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadBootstrapFiles, DEFAULT_SOUL_FILENAME } from '../workspace.js';

describe('loadBootstrapFiles', () => {
  it('reads from bootstrap dir and sets absolute path', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-bs-'));
    try {
      writeFileSync(join(root, DEFAULT_SOUL_FILENAME), '# soul\nhello');
      const files = loadBootstrapFiles(root);
      const soul = files.find((f) => f.name === DEFAULT_SOUL_FILENAME);
      expect(soul).toBeDefined();
      expect(soul!.path).toBe(resolve(join(root, DEFAULT_SOUL_FILENAME)));
      expect(soul!.content).toContain('hello');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

});
