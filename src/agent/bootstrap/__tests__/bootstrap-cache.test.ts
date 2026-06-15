import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { clearAllBootstrapSnapshots, resolveBootstrapFilesForRun } from '../bootstrap-files.js';

describe('bootstrap-cache', () => {
  it('invalidates cache when profile file changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-bootstrap-cache-'));
    const dir = join(root, 'profile');
    mkdirSync(dir, { recursive: true });
    const soulPath = join(dir, 'SOUL.md');
    writeFileSync(join(dir, 'AGENTS.md'), '# agents');
    writeFileSync(soulPath, 'version-1');

    clearAllBootstrapSnapshots();
    const sessionKey = 'agent:main:webchat:direct:cache-test';
    const first = await resolveBootstrapFilesForRun({ profileDir: dir, sessionKey });
    expect(first.find((f) => f.name === 'SOUL.md')?.content).toBe('version-1');

    writeFileSync(soulPath, 'version-2');
    const second = await resolveBootstrapFilesForRun({ profileDir: dir, sessionKey });
    expect(second.find((f) => f.name === 'SOUL.md')?.content).toBe('version-2');
  });
});
