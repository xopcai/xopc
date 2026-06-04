import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { loadProfileBootstrapFiles } from '../load-bootstrap-files.js';
import { filterBootstrapFilesForSession } from '../filter-bootstrap-files.js';
import { buildBootstrapContextFiles } from '../bootstrap-context.js';
import { resolveBootstrapContextSync } from '../bootstrap-files.js';
import { DEFAULT_MEMORY_FILENAME } from '../../context/workspace.js';

describe('bootstrap-files', () => {
  it('loads profile files in OpenClaw order and skips absent MEMORY', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-bootstrap-'));
    writeFileSync(join(dir, 'AGENTS.md'), '# agents');
    writeFileSync(join(dir, 'SOUL.md'), '# soul');
    writeFileSync(join(dir, 'USER.md'), '# user');

    const files = loadProfileBootstrapFiles(dir);
    const names = files.map((f) => f.name);
    expect(names.indexOf('AGENTS.md')).toBeLessThan(names.indexOf('SOUL.md'));
    expect(names.indexOf('SOUL.md')).toBeLessThan(names.indexOf('USER.md'));
    expect(names).not.toContain(DEFAULT_MEMORY_FILENAME);
  });

  it('filters MEMORY for subagent sessions', () => {
    const files = [
      { name: 'AGENTS.md', path: '/p/AGENTS.md', content: 'a', missing: false },
      { name: 'MEMORY.md', path: '/p/MEMORY.md', content: 'm', missing: false },
    ];
    const main = filterBootstrapFilesForSession(files, 'agent:main:webchat:direct:u1');
    expect(main.some((f) => f.name === 'MEMORY.md')).toBe(true);

    const sub = filterBootstrapFilesForSession(files, 'agent:main:subagent:telegram:default:direct:123456');
    expect(sub.some((f) => f.name === 'MEMORY.md')).toBe(false);
  });

  it('truncates oversized bootstrap content', () => {
    const files = [
      {
        name: 'SOUL.md',
        path: '/p/SOUL.md',
        content: 'x'.repeat(500),
        missing: false,
      },
    ];
    const context = buildBootstrapContextFiles(files, { maxChars: 100, totalMaxChars: 100 });
    expect(context[0]?.content.length).toBeLessThanOrEqual(100);
    expect(context[0]?.content).toContain('truncated');
  });

  it('resolveBootstrapContextSync returns contextFiles', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-bootstrap-sync-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'AGENTS.md'), '# agents');
    const { contextFiles } = resolveBootstrapContextSync({ profileDir: dir });
    expect(contextFiles.length).toBeGreaterThan(0);
    expect(contextFiles[0]?.path).toContain('AGENTS.md');
  });
});
