import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { WORKSPACE_FILES } from '../../../config/paths.js';
import { resolveWorkspaceStatePathForMarkdownWorkspace } from '../../context/workspace-state.js';
import { loadProfileBootstrapFiles } from '../load-bootstrap-files.js';
import { filterBootstrapFilesForSession } from '../filter-bootstrap-files.js';
import { buildBootstrapContextFiles } from '../bootstrap-context.js';
import {
  clearBootstrapSnapshot,
  resolveBootstrapContextSync,
} from '../bootstrap-files.js';
import { DEFAULT_MEMORY_FILENAME } from '../../context/workspace.js';

function fixtureDirs(prefix: string): { profileDir: string; workspaceStatePath: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const profileDir = join(root, 'profile');
  const markdownWs = join(root, 'workspace');
  mkdirSync(profileDir, { recursive: true });
  return {
    profileDir,
    workspaceStatePath: resolveWorkspaceStatePathForMarkdownWorkspace(markdownWs),
  };
}

describe('bootstrap-files', () => {
  it('loads profile files in OpenClaw order and skips absent MEMORY', () => {
    const { profileDir, workspaceStatePath } = fixtureDirs('xopc-bootstrap-');
    writeFileSync(join(profileDir, 'AGENTS.md'), '# agents');
    writeFileSync(join(profileDir, 'SOUL.md'), '# soul');
    writeFileSync(join(profileDir, 'USER.md'), '# user');

    const files = loadProfileBootstrapFiles(profileDir, workspaceStatePath);
    const names = files.map((f) => f.name);
    expect(names.indexOf('AGENTS.md')).toBeLessThan(names.indexOf('SOUL.md'));
    expect(names.indexOf('SOUL.md')).toBeLessThan(names.indexOf('USER.md'));
    expect(names).not.toContain(DEFAULT_MEMORY_FILENAME);
  });

  it('omits BOOTSTRAP.md after setupCompletedAt is recorded', () => {
    const { profileDir, workspaceStatePath } = fixtureDirs('xopc-bootstrap-done-');
    writeFileSync(join(profileDir, WORKSPACE_FILES.BOOTSTRAP), '# bootstrap');
    mkdirSync(dirname(workspaceStatePath), { recursive: true });
    writeFileSync(
      workspaceStatePath,
      JSON.stringify(
        {
          version: 1,
          bootstrapSeededAt: '2026-01-01T00:00:00.000Z',
          setupCompletedAt: '2026-01-02T00:00:00.000Z',
        },
        null,
        2,
      ),
      'utf-8',
    );

    const files = loadProfileBootstrapFiles(profileDir, workspaceStatePath);
    expect(files.some((f) => f.name === WORKSPACE_FILES.BOOTSTRAP)).toBe(false);
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
    const { profileDir, workspaceStatePath } = fixtureDirs('xopc-bootstrap-sync-');
    writeFileSync(join(profileDir, 'AGENTS.md'), '# agents');
    const { contextFiles } = resolveBootstrapContextSync({ profileDir, workspaceStatePath });
    expect(contextFiles.length).toBeGreaterThan(0);
    expect(contextFiles[0]?.path).toContain('AGENTS.md');
  });

  it('continuation-skip injects bootstrap once per session key', () => {
    const { profileDir, workspaceStatePath } = fixtureDirs('xopc-bootstrap-skip-');
    writeFileSync(join(profileDir, 'AGENTS.md'), '# agents');
    const sessionKey = 'agent:main:webchat:default:direct:u1';
    const params = {
      profileDir,
      workspaceStatePath,
      sessionKey,
      contextInjection: 'continuation-skip' as const,
    };

    const first = resolveBootstrapContextSync(params);
    expect(first.contextFiles.length).toBeGreaterThan(0);

    const second = resolveBootstrapContextSync(params);
    expect(second.contextFiles).toEqual([]);

    clearBootstrapSnapshot(sessionKey);
    const afterReset = resolveBootstrapContextSync(params);
    expect(afterReset.contextFiles.length).toBeGreaterThan(0);
  });
});
