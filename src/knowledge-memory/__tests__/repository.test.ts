import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import {
  getKnowledgeItem,
  deleteKnowledgeItem,
  listKnowledgeStatusEvents,
  listKnowledgeItems,
  reviewKnowledgeItem,
  searchKnowledgeItems,
  transitionKnowledgeStatus,
  writeKnowledgeItem,
} from '../index.js';

const context = {
  agentId: 'main',
  workspaceId: '/workspace',
  projectId: 'project-1',
  conversationId: 'session-1',
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
    transitionKnowledgeStatus({
      id: first.item.id, status: 'archived', actor: 'runtime', reason: 'Source disappeared.', now: 200,
    });

    const restored = writeKnowledgeItem({
      kind: 'workspace_fact', scope: { type: 'workspace', id: '/workspace' },
      canonicalKey: 'source:file:profile', content: 'Restored source content',
      confidence: 0.85, importance: 0.6, originClass: 'untrusted', status: 'active',
      replaceExisting: true, now: 300,
    });

    expect(restored).toMatchObject({ created: false, item: { id: first.item.id, status: 'active' } });
    expect(getKnowledgeItem(first.item.id)?.content).toBe('Restored source content');
  });

  it('reviews candidates atomically and records an audit event', () => {
    const candidate = writeKnowledgeItem({
      kind: 'decision', scope: { type: 'workspace', id: '/workspace' },
      canonicalKey: 'decision:review', content: 'Ship on Friday.',
      confidence: 0.7, importance: 0.8, originClass: 'agent', status: 'candidate', now: 100,
    }).item;

    const reviewed = reviewKnowledgeItem({
      id: candidate.id,
      action: 'edit_and_approve',
      actor: 'user',
      reason: 'Corrected and confirmed by the user.',
      expectedStatus: 'candidate',
      content: 'Ship on Monday.',
      now: 200,
    });

    expect(reviewed).toMatchObject({ status: 'active', content: 'Ship on Monday.', updatedAt: 200 });
    expect(searchKnowledgeItems({ query: 'Monday', context })).toHaveLength(1);
    expect(searchKnowledgeItems({ query: 'Friday', context })).toEqual([]);
    expect(listKnowledgeStatusEvents(candidate.id)).toEqual([
      expect.objectContaining({ toStatus: 'candidate', actor: 'agent', createdAt: 100 }),
      expect.objectContaining({
        fromStatus: 'candidate',
        toStatus: 'active',
        actor: 'user',
        reason: 'Corrected and confirmed by the user.',
        createdAt: 200,
      }),
    ]);
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
    expect(searchKnowledgeItems({ query: 'Build failed', context, trustedOnly: true })).toEqual([]);
  });

  it('applies visibility scope and content source policies independently', () => {
    writeKnowledgeItem({
      kind: 'workspace_fact', scope: { type: 'agent', id: 'main' },
      canonicalKey: 'agent:atlas', content: 'Atlas agent release plan',
      confidence: 1, importance: 1, originClass: 'owner', status: 'active',
    });
    writeKnowledgeItem({
      kind: 'project_fact', scope: { type: 'project', id: 'project-1' },
      canonicalKey: 'project:atlas', content: 'Atlas project release plan',
      confidence: 1, importance: 1, originClass: 'owner', status: 'active',
    });
    writeKnowledgeItem({
      kind: 'workspace_fact', scope: { type: 'workspace', id: '/workspace' },
      canonicalKey: 'workspace:atlas', content: 'Atlas workspace release plan',
      confidence: 1, importance: 1, originClass: 'owner', status: 'active',
    });
    writeKnowledgeItem({
      kind: 'workspace_fact', scope: { type: 'workspace', id: '/workspace' },
      canonicalKey: 'import:atlas', content: 'Atlas imported release plan',
      recordClass: 'source_index', source: { kind: 'product_import' },
      confidence: 1, importance: 1, originClass: 'owner', status: 'active',
    });
    writeKnowledgeItem({
      kind: 'workspace_fact', scope: { type: 'workspace', id: '/workspace' },
      canonicalKey: 'connector:atlas', content: 'Atlas connected release plan',
      recordClass: 'source_index', source: { kind: 'gmail' },
      confidence: 1, importance: 1, originClass: 'owner', status: 'active',
    });

    expect(searchKnowledgeItems({
      query: 'Atlas release',
      context,
      policy: { scopes: ['project'], contentSources: ['memory'] },
    })
      .map((item) => item.canonicalKey)).toEqual(['project:atlas']);
    expect(searchKnowledgeItems({
      query: 'Atlas release',
      context,
      policy: { scopes: ['agent'], contentSources: ['memory'] },
    }).map((item) => item.canonicalKey)).toEqual(['agent:atlas']);
    expect(searchKnowledgeItems({
      query: 'Atlas release',
      context,
      policy: { scopes: ['workspace'], contentSources: ['local_import'] },
    }).map((item) => item.canonicalKey)).toEqual(['import:atlas']);
    expect(searchKnowledgeItems({
      query: 'Atlas release',
      context,
      policy: { scopes: ['workspace'], contentSources: ['connector'] },
    }).map((item) => item.canonicalKey)).toEqual(['connector:atlas']);
  });
  it('protects user edits from source refresh and deletes linked derived memories', () => {
    const input = { kind: 'project_fact' as const, scope: { type: 'project' as const, id: 'project-1' },
      canonicalKey: 'fact', content: 'Atlas uses pnpm', confidence: 0.8, importance: 0.5, originClass: 'agent' as const };
    const original = writeKnowledgeItem(input).item;
    reviewKnowledgeItem({ id: original.id, action: 'edit_and_approve', actor: 'user', reason: 'Correction', content: 'Atlas uses bun' });
    expect(writeKnowledgeItem({ ...input, replaceExisting: true }).item.content).toBe('Atlas uses bun');
    const derived = writeKnowledgeItem({ ...input, canonicalKey: 'derived', content: 'Use bun for Atlas',
      source: { episodeKnowledgeId: original.id } }).item;
    expect(deleteKnowledgeItem(original.id)).toBe(true);
    expect(getKnowledgeItem(derived.id)).toBeUndefined();
    expect(writeKnowledgeItem(input).item).toBeUndefined();
    expect(searchKnowledgeItems({ query: 'Atlas', context })).toEqual([]);
  });

});
