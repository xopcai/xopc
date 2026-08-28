import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { StubMemoryProvider } from '../stub-memory-provider.js';
import { MemoryManager } from '../manager.js';
import { BuiltinMemoryProvider } from '../builtin-provider.js';
import {
  closeXopcDatabase,
  getUnderstanding,
  listMemoryTraceEvents,
  listUnderstandingEvidence,
  listUnderstandings,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';

describe('MemoryManager', () => {
  it('keeps local and multiple external providers for fanout routing', () => {
    const m = new MemoryManager();
    m.addProvider(new BuiltinMemoryProvider());
    m.addProvider(new StubMemoryProvider());
    m.addProvider(new StubMemoryProvider());
    const ids = m.providersList.map((p) => p.id);
    expect(ids).toEqual(['local', 'stub', 'stub']);
  });

  it('keeps the local provider writable', () => {
    const mgr = new MemoryManager();
    mgr.addProvider(new BuiltinMemoryProvider());
    const ids = mgr.providersList.map((p) => p.id);
    expect(ids).toContain('local');
    expect(mgr.providersList.find((p) => p.id === 'local')?.capabilities.write).toBe(true);
  });

  it('stores a fingerprint instead of the raw retrieval query in traces', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'xopc-memory-trace-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    try {
      const mgr = new MemoryManager();
      mgr.addProvider(new StubMemoryProvider());
      await mgr.search({ query: 'password=hunter2', scope: { sessionKey: 'session-private' } });

      const request = listMemoryTraceEvents({ phase: 'search' })[0]?.request as { query?: string };
      expect(request.query).toMatch(/^sha256:[a-f0-9]{24};length=16$/);
      expect(request.query).not.toContain('hunter2');
    } finally {
      closeXopcDatabase();
      resetXopcDatabaseSingletonForTest();
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('writes proposed memories as candidates outside default recall', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'xopc-memory-manager-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    try {
      const mgr = new MemoryManager({
        writeStrategy: 'external-only',
        writePolicy: { allowExternalWrites: true, allowedProviderIds: ['stub'] },
      });
      mgr.addProvider(new BuiltinMemoryProvider());
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

      const listed = await mgr.list({ scope: { workspaceId: stateDir, sessionKey: 'session-1' } });
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
      const mgr = new MemoryManager();
      mgr.addProvider(new BuiltinMemoryProvider());
      await mgr.initializeAll('session-2', { workspace: stateDir, agentId: 'main' });

      await mgr.syncAll(
        '记住：这个项目默认使用 pnpm，不要生成 package-lock.json。',
        '我会记住这个偏好。',
        { sessionId: 'session-2' },
      );

      const understanding = listUnderstandings().find((record) => record.statement.includes('pnpm'));
      expect(understanding?.status).toBe('active');
      expect(understanding?.explicitness).toBe('explicit');
      expect(understanding?.canonicalKey).toMatch(/^boundary:/);
      expect(listUnderstandingEvidence(understanding!.id)[0]?.sourceRef).toContain('session:session-2:');

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

  it('uses immutable session context for background workspace candidates', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'xopc-memory-background-scope-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    try {
      const mgr = new MemoryManager();
      mgr.addProvider(new BuiltinMemoryProvider());
      await mgr.initializeAll('session-background', { workspace: stateDir, agentId: 'research' });

      const result = await mgr.applyUnderstandingCandidates([{
        kind: 'project_context',
        content: 'This project releases from the main branch.',
        confidence: 0.9,
        importance: 0.8,
        explicitness: 'inferred',
        durability: 'durable',
        sensitivity: 'normal',
        disclosurePolicy: 'referenceable',
      }], { sessionKey: 'session-background', reviewSource: 'background' });

      const record = getUnderstanding(result.createdRecords[0]!.id);
      expect(record?.scope).toEqual({ type: 'workspace', id: stateDir });
      expect(record?.status).toBe('candidate');
    } finally {
      closeXopcDatabase();
      resetXopcDatabaseSingletonForTest();
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
