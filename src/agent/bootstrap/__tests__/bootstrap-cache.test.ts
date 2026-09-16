import { requireXopcDatabase as openFixtureDatabase } from '../../../storage/sqlite/connection.js';
import { ensureSessionRecord as ensureFixtureConversation } from '../../../storage/sqlite/session-repository.js';
function seedConversationFixtures(): void {
  openFixtureDatabase();
  ensureFixtureConversation("01826781-da65-465d-8d8d-35e57c3565f3", '', {"agentId":"main","sourceChannel":"webchat","sourceChatId":"cache-test","sessionType":"chat","routing":{"agentId":"main","source":"webchat","accountId":"default","peerKind":"direct","peerId":"cache-test"}});
}
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { clearAllBootstrapSnapshots, resolveBootstrapFilesForRun } from '../bootstrap-files.js';

describe('bootstrap-cache', () => {
  it('invalidates cache when profile file changes', async () => {
    seedConversationFixtures();
    const root = mkdtempSync(join(tmpdir(), 'xopc-bootstrap-cache-'));
    const dir = join(root, 'profile');
    mkdirSync(dir, { recursive: true });
    const soulPath = join(dir, 'SOUL.md');
    writeFileSync(join(dir, 'AGENTS.md'), '# agents');
    writeFileSync(soulPath, 'version-1');

    clearAllBootstrapSnapshots();
    const conversationId = "01826781-da65-465d-8d8d-35e57c3565f3";
    const first = await resolveBootstrapFilesForRun({ profileDir: dir, conversationId });
    expect(first.find((f) => f.name === 'SOUL.md')?.content).toBe('version-1');

    writeFileSync(soulPath, 'version-2');
    const second = await resolveBootstrapFilesForRun({ profileDir: dir, conversationId });
    expect(second.find((f) => f.name === 'SOUL.md')?.content).toBe('version-2');
  });
});
