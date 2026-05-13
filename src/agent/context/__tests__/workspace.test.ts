import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

import { loadProfileMarkdownFiles, DEFAULT_SOUL_FILENAME } from '../workspace.js';

describe('loadProfileMarkdownFiles', () => {
  it('reads from workspace root and sets absolute path', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-ws-'));
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, DEFAULT_SOUL_FILENAME), '# SOUL\n\nHello', 'utf-8');

    const files = loadProfileMarkdownFiles(root);
    const soul = files.find((f) => f.name === DEFAULT_SOUL_FILENAME);
    expect(soul).toBeDefined();
    expect(soul?.missing ?? false).toBe(false);
    expect(soul?.content).toContain('Hello');
    expect(soul?.path).toBeDefined();
    expect(soul?.path?.startsWith('/')).toBe(true);
  });
});
