import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SessionStatus } from '../../../session/types.js';
import { closeXopcDatabase, ensureSessionRecord, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../index.js';
import { listSessionMetadata } from '../session-repository.js';
import { getSqliteDatabase } from '../transaction.js';
import type { SessionMetadataSeed } from '../session-metadata.js';

describe('session discovery across stored history', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-discovery-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
  });
  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });
  function seed(id: string, metadata: SessionMetadataSeed) {
    return ensureSessionRecord(randomUUID(), dir, { agentId: metadata.routing?.agentId ?? 'main', name: id, sourceChannel: 'webchat', hiddenFromSessionList: false, ...metadata });
  }

  it('applies OR within a dimension and AND across dimensions before counting and pagination', () => {
    const old = new Date(Date.now() - 90 * 86_400_000).toISOString();
    for (let i = 0; i < 65; i++) seed(`history-${i}`, { sourceChannel: i % 2 ? 'cli' : 'webchat', updatedAt: old });
    seed('hidden', { hiddenFromSessionList: true });
    seed('archived', { status: SessionStatus.ARCHIVED });
    seed('pinned', { status: SessionStatus.PINNED, sourceChannel: 'telegram', updatedAt: old });
    const query = { sources: ['workbench', 'terminal'] as const, purposes: ['chat'] as const, excludeArchived: true };
    const first = listSessionMetadata({ ...query, sources: [...query.sources], purposes: [...query.purposes], limit: 20 });
    const third = listSessionMetadata({ ...query, sources: [...query.sources], purposes: [...query.purposes], limit: 20, offset: 40 });
    expect(first.total).toBe(65);
    expect(third.items).toHaveLength(20);
    expect(third.hasMore).toBe(true);
    expect(third.items.some((r) => first.items.some((a) => a.key === r.key))).toBe(false);
    expect(listSessionMetadata({ sources: ['telegram'], updatedAfter: Date.now() - 7 * 86_400_000 }).total).toBe(0);
    expect(listSessionMetadata({ sources: ['workbench'], status: SessionStatus.ARCHIVED }).items.map((r) => r.name)).toEqual(['archived']);
  });

  it('searches message content beyond 500 sessions and still applies source filters', () => {
    const db = getSqliteDatabase();
    for (let i = 0; i < 510; i++) {
      const row = seed(`unrelated-title-${i}`, { sourceChannel: i === 509 ? 'cli' : 'webchat' });
      db.prepare('INSERT INTO transcript_fts(content, conversation_id, transcript_id, entry_id) VALUES (?, ?, ?, ?)')
        .run('needlecontent', row.key, row.transcriptId!, `entry-${i}`);
    }
    expect(listSessionMetadata({ search: 'needlecontent' }).total).toBe(510);
    expect(listSessionMetadata({ search: 'needlecontent', sources: ['terminal'] }).items.map((r) => r.name)).toEqual(['unrelated-title-509']);
  });

  it('combines project and Agent filters without including unassigned sessions', () => {
    seed('project-coder', { projectId: 'project-a', sourceChannel: 'cli', routing: { agentId: 'coder', source: 'cli', accountId: 'default', peerKind: 'dm', peerId: 'one' } });
    seed('project-main', { projectId: 'project-a', sourceChannel: 'cli' });
    seed('unassigned', { sourceChannel: 'cli' });
    expect(listSessionMetadata({ projectId: 'project-a', agentId: 'coder', sources: ['terminal'] }).items.map((r) => r.name)).toEqual(['project-coder']);
    expect(listSessionMetadata({ unassigned: true, sources: ['terminal'] }).items.map((r) => r.name)).toEqual(['unassigned']);
  });
});
