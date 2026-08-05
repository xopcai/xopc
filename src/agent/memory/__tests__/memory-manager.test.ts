import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { BuiltinMemoryStore } from '../builtin-memory-store.js';
import { StubMemoryProvider } from '../stub-memory-provider.js';
import { MemoryManager } from '../manager.js';
import { BuiltinMemoryProvider } from '../builtin-provider.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';

describe('MemoryManager', () => {
  it('keeps local and multiple external providers for fanout routing', () => {
    const m = new MemoryManager();
    const store = new BuiltinMemoryStore({
      workspaceDir: '/tmp',
      memoriesDir: '/tmp/memories',
      userMemoryPath: '/tmp/user/MEMORY.md',
      memoryCharLimit: 100,
      userCharLimit: 100,
    });
    m.addProvider(new BuiltinMemoryProvider(store));
    m.addProvider(new StubMemoryProvider());
    m.addProvider(new StubMemoryProvider());
    const ids = m.providersList.map((p) => p.id);
    expect(ids).toEqual(['local', 'stub', 'stub']);
  });

  it('keeps the local provider writable', () => {
    const store = new BuiltinMemoryStore({
      workspaceDir: '/tmp',
      memoriesDir: '/tmp/memories',
      userMemoryPath: '/tmp/user/MEMORY.md',
      memoryCharLimit: 100,
      userCharLimit: 100,
    });
    const mgr = new MemoryManager();
    mgr.addProvider(new BuiltinMemoryProvider(store));
    const ids = mgr.providersList.map((p) => p.id);
    expect(ids).toContain('local');
    expect(mgr.providersList.find((p) => p.id === 'local')?.capabilities.write).toBe(true);
  });

  it('writes proposed memories as candidates outside default recall', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'xopc-memory-manager-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    try {
      const store = new BuiltinMemoryStore({
        workspaceDir: stateDir,
        memoriesDir: join(stateDir, 'memories'),
        userMemoryPath: join(stateDir, 'user', 'MEMORY.md'),
        memoryCharLimit: 1000,
        userCharLimit: 1000,
      });
      const mgr = new MemoryManager({
        writeStrategy: 'external-only',
        writePolicy: { allowExternalWrites: true, allowedProviderIds: ['stub'] },
      });
      mgr.addProvider(new BuiltinMemoryProvider(store));
      mgr.addProvider(new StubMemoryProvider());
      await mgr.initializeAll('session-1', { workspace: stateDir, agentId: 'main' });

      const write = await mgr.write({
        kind: 'task_lesson',
        content: 'Use the omega checklist before promoting memory candidates.',
        status: 'candidate',
        sensitivity: 'normal',
        evidence: [{ sessionKey: 'session-1', sourceText: 'The omega checklist prevented a bad promotion.' }],
        source: { provider: 'composio-gmail', sourceInstanceId: 'gmail-work' },
        scope: { sessionKey: 'session-1' },
      });

      expect(write.success).toBe(true);
      expect(write.record?.status).toBe('candidate');
      expect(write.record?.evidence?.[0]?.sourceText).toContain('omega checklist');
      expect(write.record?.source).toMatchObject({ provider: 'composio-gmail', sourceInstanceId: 'gmail-work' });

      const listed = await mgr.list({ scope: { agentId: 'main', workspaceId: stateDir } });
      expect(listed.map((record) => record.id)).toContain(write.record?.id);

      const recalled = await mgr.search({
        query: 'omega checklist',
        scope: { agentId: 'main', workspaceId: stateDir },
      });
      expect(recalled).toHaveLength(0);
    } finally {
      closeXopcDatabase();
      resetXopcDatabaseSingletonForTest();
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('auto-proposes explicit remember requests during turn sync', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'xopc-memory-sync-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    try {
      const store = new BuiltinMemoryStore({
        workspaceDir: stateDir,
        memoriesDir: join(stateDir, 'memories'),
        userMemoryPath: join(stateDir, 'user', 'MEMORY.md'),
        memoryCharLimit: 1000,
        userCharLimit: 1000,
      });
      const mgr = new MemoryManager();
      mgr.addProvider(new BuiltinMemoryProvider(store));
      await mgr.initializeAll('session-2', { workspace: stateDir, agentId: 'main' });

      await mgr.syncAll(
        '记住：这个项目默认使用 pnpm，不要生成 package-lock.json。',
        '我会记住这个偏好。',
        { sessionId: 'session-2' },
      );

      const listed = await mgr.list({ scope: { agentId: 'main', workspaceId: stateDir } });
      const candidate = listed.find((record) => record.content.includes('pnpm'));
      expect(candidate?.status).toBe('candidate');
      expect(candidate?.tags).toContain('user-understanding');
      expect(candidate?.explicitness).toBe('explicit');
      expect(candidate?.canonicalKey).toMatch(/^boundary:/);
      expect(candidate?.evidence?.[0]?.sessionKey).toBe('session-2');

      const recalled = await mgr.search({
        query: 'package-lock',
        scope: { agentId: 'main', workspaceId: stateDir },
      });
      expect(recalled).toHaveLength(0);
    } finally {
      closeXopcDatabase();
      resetXopcDatabaseSingletonForTest();
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
