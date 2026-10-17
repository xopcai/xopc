import { requireXopcDatabase as openFixtureDatabase } from '../../../storage/sqlite/connection.js';
import { ensureSessionRecord as ensureFixtureConversation } from '../../../storage/sqlite/session-repository.js';
function seedConversationFixtures(): void {
  openFixtureDatabase();
  ensureFixtureConversation("468085fe-e315-444e-85ab-7f3b715e35e4", '', {"agentId":"main","sourceChannel":"webchat","sourceChatId":"u1","sessionType":"chat","routing":{"agentId":"main","source":"webchat","accountId":"default","peerKind":"direct","peerId":"u1"}});
}
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadProfileBootstrapFiles } from '../load-bootstrap-files.js';
import { buildBootstrapContextFiles } from '../bootstrap-context.js';
import {
  clearBootstrapSnapshot,
  resolveBootstrapContextSync,
} from '../bootstrap-files.js';

function fixtureProfileDir(prefix: string): string {
  const profileDir = join(mkdtempSync(join(tmpdir(), prefix)), 'profile');
  mkdirSync(profileDir, { recursive: true });
  return profileDir;
}

describe('bootstrap-files', () => {
  it('loads profile files in OpenClaw order and skips absent optional files', () => {
    seedConversationFixtures();
    const profileDir = fixtureProfileDir('xopc-bootstrap-');
    writeFileSync(join(profileDir, 'AGENTS.md'), '# agents');
    writeFileSync(join(profileDir, 'SOUL.md'), '# soul');
    writeFileSync(join(profileDir, 'HEARTBEAT.md'), '# legacy heartbeat');

    const files = loadProfileBootstrapFiles(profileDir);
    const names = files.map((f) => f.name);
    expect(names.indexOf('AGENTS.md')).toBeLessThan(names.indexOf('SOUL.md'));
    expect(names).not.toContain('MEMORY.md');
    expect(names).not.toContain('TOOLS.md');
    expect(names).not.toContain('HEARTBEAT.md');
  });

  it('emits missing markers only for required profile files', () => {
    seedConversationFixtures();
    const profileDir = fixtureProfileDir('xopc-bootstrap-missing-');
    writeFileSync(join(profileDir, 'SOUL.md'), '# soul');

    const files = loadProfileBootstrapFiles(profileDir);
    expect(files.find((f) => f.name === 'SOUL.md')?.missing).toBe(false);
    expect(files.some((f) => f.name === 'AGENTS.md')).toBe(false);
    expect(files.some((f) => f.name === 'USER.md')).toBe(false);
    expect(files.some((f) => f.name === 'MEMORY.md')).toBe(false);
  });

  it('truncates oversized bootstrap content', () => {
    seedConversationFixtures();
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
    seedConversationFixtures();
    const profileDir = fixtureProfileDir('xopc-bootstrap-sync-');
    writeFileSync(join(profileDir, 'AGENTS.md'), '# agents');
    const { contextFiles } = resolveBootstrapContextSync({ profileDir });
    expect(contextFiles.length).toBeGreaterThan(0);
    expect(contextFiles[0]?.path).toContain('AGENTS.md');
  });

  it('continuation-skip injects bootstrap once per session key', () => {
    seedConversationFixtures();
    const profileDir = fixtureProfileDir('xopc-bootstrap-skip-');
    writeFileSync(join(profileDir, 'AGENTS.md'), '# agents');
    const conversationId = "468085fe-e315-444e-85ab-7f3b715e35e4";
    const params = {
      profileDir,
      conversationId,
      contextInjection: 'continuation-skip' as const,
    };

    const first = resolveBootstrapContextSync(params);
    expect(first.contextFiles.length).toBeGreaterThan(0);

    const second = resolveBootstrapContextSync(params);
    expect(second.contextFiles).toEqual([]);

    clearBootstrapSnapshot(conversationId);
    const afterReset = resolveBootstrapContextSync(params);
    expect(afterReset.contextFiles.length).toBeGreaterThan(0);
  });

  it('keeps repository instructions out of profile bootstrap context', () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'xopc-project-agents-'));
    const profileDir = join(workspaceDir, 'profile');
    mkdirSync(profileDir);
    writeFileSync(join(workspaceDir, 'AGENTS.md'), 'Repository-only rule');
    writeFileSync(join(profileDir, 'AGENTS.md'), 'Profile-only rule');

    const { contextFiles } = resolveBootstrapContextSync({ profileDir });
    expect(contextFiles.map(file => file.content).join('\n')).toContain('Profile-only rule');
    expect(contextFiles.map(file => file.content).join('\n')).not.toContain('Repository-only rule');
  });
});
