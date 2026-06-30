import { describe, expect, it } from 'vitest';
import { isAbsolute } from 'node:path';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

import {
  DEFAULT_SOUL_FILENAME,
  loadProfileMarkdownFiles,
} from '../workspace.js';

describe('loadProfileMarkdownFiles', () => {
  it('reads from profile dir and sets absolute path', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-ws-'));
    const profileDir = join(root, 'profile');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, DEFAULT_SOUL_FILENAME), '# SOUL\n\nHello', 'utf-8');

    const files = loadProfileMarkdownFiles(profileDir);
    const soul = files.find((f) => f.name === DEFAULT_SOUL_FILENAME);
    expect(soul).toBeDefined();
    expect(soul?.missing ?? false).toBe(false);
    expect(soul?.content).toContain('Hello');
    expect(soul?.path).toBeDefined();
    expect(isAbsolute(soul!.path!)).toBe(true);
  });

  it('reports missing required files but skips missing optional files', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-ws-missing-'));
    const profileDir = join(root, 'profile');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, DEFAULT_SOUL_FILENAME), '# SOUL\n\nHello', 'utf-8');

    const files = loadProfileMarkdownFiles(profileDir);
    expect(files.find((f) => f.name === 'IDENTITY.md')?.missing).toBe(true);
    expect(files.some((f) => f.name === 'AGENTS.md')).toBe(false);
    expect(files.some((f) => f.name === 'USER.md')).toBe(false);
    expect(files.some((f) => f.name === 'MEMORY.md')).toBe(false);
  });
});
