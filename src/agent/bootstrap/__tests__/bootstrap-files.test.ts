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
import { loadProjectAgentsContextFile } from '../project-agents-context.js';

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
    writeFileSync(join(profileDir, 'IDENTITY.md'), '# identity');

    const files = loadProfileBootstrapFiles(profileDir);
    const names = files.map((f) => f.name);
    expect(names.indexOf('AGENTS.md')).toBeLessThan(names.indexOf('SOUL.md'));
    expect(names.indexOf('SOUL.md')).toBeLessThan(names.indexOf('IDENTITY.md'));
    expect(names).not.toContain('MEMORY.md');
    expect(names).not.toContain('TOOLS.md');
    expect(names).not.toContain('HEARTBEAT.md');
  });

  it('emits missing markers only for required profile files', () => {
    seedConversationFixtures();
    const profileDir = fixtureProfileDir('xopc-bootstrap-missing-');
    writeFileSync(join(profileDir, 'SOUL.md'), '# soul');

    const files = loadProfileBootstrapFiles(profileDir);
    expect(files.find((f) => f.name === 'IDENTITY.md')?.missing).toBe(true);
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

  it('loads project AGENTS.md from workspace root only', () => {
    seedConversationFixtures();
    const workspaceDir = mkdtempSync(join(tmpdir(), 'xopc-project-agents-'));
    mkdirSync(join(workspaceDir, 'nested'), { recursive: true });
    writeFileSync(
      join(workspaceDir, 'AGENTS.md'),
      `---\ntitle: ignored\n---\n# Project Rules\n\nRun pnpm test.\n`,
    );
    writeFileSync(join(workspaceDir, 'nested', 'AGENTS.md'), '# Nested Rules');

    const rootContext = loadProjectAgentsContextFile(workspaceDir);
    const nestedContext = loadProjectAgentsContextFile(join(workspaceDir, 'nested'));

    expect(rootContext?.path).toBe(join(workspaceDir, 'AGENTS.md'));
    expect(rootContext?.content).toContain('Workspace AGENTS.md contains project-local instructions.');
    expect(rootContext?.content).toContain('# Project Rules');
    expect(rootContext?.content).not.toContain('title: ignored');
    expect(nestedContext?.content).toContain('# Nested Rules');
  });
});
