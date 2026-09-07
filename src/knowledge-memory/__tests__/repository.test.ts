import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import {
  getKnowledgeItem,
  listKnowledgeItems,
  searchKnowledgeItems,
  setKnowledgeStatus,
  writeKnowledgeItem,
} from '../index.js';

const context = {
  agentId: 'main',
  workspaceId: '/workspace',
  projectId: 'project-1',
  sessionId: 'session-1',
};

describe('knowledge repository', () => {
  beforeEach(() => {
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  it('returns only active, current knowledge visible in the execution scope', () => {
    for (const [scope, canonicalKey, expiresAt] of [
      [{ type: 'global' as const }, 'global', undefined],
      [{ type: 'workspace' as const, id: '/workspace' }, 'workspace', undefined],
      [{ type: 'project' as const, id: 'project-1' }, 'project', undefined],
      [{ type: 'session' as const, id: 'other-session' }, 'other-session', undefined],
      [{ type: 'global' as const }, 'expired', 500],
    ] as const) {
      writeKnowledgeItem({
        kind: 'project_fact', scope, canonicalKey,
        content: `Atlas release knowledge ${canonicalKey}`,
        confidence: 0.9, importance: 0.7, originClass: 'owner',
        ...(expiresAt === undefined ? {} : { expiresAt }), now: 100,
      });
    }

    expect(searchKnowledgeItems({ query: 'Atlas release', context, asOf: 1_000 })
      .map((item) => item.canonicalKey)).toEqual(expect.arrayContaining(['global', 'workspace', 'project']));
    expect(searchKnowledgeItems({ query: 'Atlas release', context, asOf: 1_000 })
      .map((item) => item.canonicalKey)).not.toEqual(expect.arrayContaining(['other-session', 'expired']));
  });

  it('updates one canonical item and revives it when its source returns', () => {
    const first = writeKnowledgeItem({
      kind: 'workspace_fact', scope: { type: 'workspace', id: '/workspace' },
      canonicalKey: 'source:file:profile', content: 'Original source content',
      confidence: 0.8, importance: 0.5, originClass: 'untrusted', status: 'active', now: 100,
    });
    setKnowledgeStatus(first.item.id, 'archived', 200);

    const restored = writeKnowledgeItem({
      kind: 'workspace_fact', scope: { type: 'workspace', id: '/workspace' },
      canonicalKey: 'source:file:profile', content: 'Restored source content',
      confidence: 0.85, importance: 0.6, originClass: 'untrusted', status: 'active',
      replaceExisting: true, now: 300,
    });

    expect(restored).toMatchObject({ created: false, item: { id: first.item.id, status: 'active' } });
    expect(getKnowledgeItem(first.item.id)?.content).toBe('Restored source content');
  });

  it('keeps source index records separate from user-facing work memory', () => {
    writeKnowledgeItem({
      kind: 'workspace_fact', scope: { type: 'workspace', id: '/workspace' },
      canonicalKey: 'source-item:gmail:message-1', content: '{"subject":"Build failed"}',
      recordClass: 'source_index', confidence: 0.8, importance: 0.5,
      originClass: 'untrusted', status: 'active',
    });
    writeKnowledgeItem({
      kind: 'decision', scope: { type: 'workspace', id: '/workspace' },
      canonicalKey: 'decision:release', content: 'Release after the failing CI check is fixed.',
      confidence: 0.9, importance: 0.8, originClass: 'agent', status: 'active',
    });

    expect(listKnowledgeItems({ recordClass: 'memory' }).map((item) => item.canonicalKey))
      .toEqual(['decision:release']);
    expect(searchKnowledgeItems({ query: 'Build failed', context })[0]).toMatchObject({
      canonicalKey: 'source-item:gmail:message-1', recordClass: 'source_index',
    });
  });
});
