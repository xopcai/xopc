import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  attachMemoryEvidence,
  claimKnowledgeSourceItems,
  closeXopcDatabase,
  completeKnowledgeSourceItemSynthesis,
  getKnowledgeConsumerWatermark,
  getKnowledgeSourceCursor,
  listKnowledgeSourceChanges,
  listKnowledgeSourceItems,
  listMemoryEvidence,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  setKnowledgeConsumerWatermark,
  setKnowledgeSourceCursor,
  upsertKnowledgeSourceItems,
  upsertMemoryRecord,
} from '../index.js';

describe('knowledge repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-knowledge-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('upserts source items idempotently and persists cursors and evidence', () => {
    const input = {
      sourceInstanceId: 'calendar:personal',
      collectionScope: 'events',
      externalId: 'event-1',
      itemType: 'calendar_event',
      contentHash: 'hash-1',
      normalizedText: 'Design review at 10:00',
    };
    const first = upsertKnowledgeSourceItems([input]);
    const second = upsertKnowledgeSourceItems([input]);
    expect(first.created).toBe(1);
    expect(second.unchanged).toBe(1);
    expect(listKnowledgeSourceItems()).toHaveLength(1);

    setKnowledgeSourceCursor('calendar:personal', 'events', 'cursor-2');
    setKnowledgeSourceCursor('calendar:personal', 'tasks', 'cursor-3');
    expect(getKnowledgeSourceCursor('calendar:personal', 'events')).toBe('cursor-2');
    expect(getKnowledgeSourceCursor('calendar:personal', 'tasks')).toBe('cursor-3');

    const record = upsertMemoryRecord({
      providerId: 'local',
      kind: 'commitment',
      sourceAgentId: 'main',
      content: 'Attend the design review.',
    });
    const evidence = attachMemoryEvidence({
      recordId: record.id,
      sourceItemId: first.items[0]?.id,
      excerpt: input.normalizedText,
      confidence: 0.9,
    });
    const repeated = attachMemoryEvidence({
      recordId: record.id,
      sourceItemId: first.items[0]?.id,
      excerpt: input.normalizedText,
      confidence: 0.8,
    });
    expect(repeated.evidenceId).toBe(evidence.evidenceId);
    expect(listMemoryEvidence(record.id)).toHaveLength(1);
    expect(listMemoryEvidence(record.id)[0]).toMatchObject({
      sourceItemId: first.items[0]?.id,
      relation: 'supports',
      confidence: 0.9,
    });
  });

  it('records ordered source changes and keeps consumer watermarks monotonic', () => {
    const base = {
      sourceInstanceId: 'mail:work',
      collectionScope: 'messages',
      externalId: 'message-1',
      itemType: 'email',
      contentHash: 'hash-1',
      normalizedText: 'First version',
    };
    const created = upsertKnowledgeSourceItems([base], 1_000);
    upsertKnowledgeSourceItems([{ ...base, contentHash: 'hash-2', normalizedText: 'Second version' }], 2_000);
    upsertKnowledgeSourceItems([{ ...base, contentHash: 'hash-2', deletedAt: '2026-07-20T00:00:00.000Z' }], 3_000);

    expect(listKnowledgeSourceChanges({ sourceInstanceId: 'mail:work' }).map((change) => change.kind))
      .toEqual(['added', 'modified', 'deleted']);
    expect(listKnowledgeSourceChanges({ afterSequence: 1 })).toHaveLength(2);
    expect(listKnowledgeSourceChanges()[0]?.sourceItemId).toBe(created.items[0]?.id);

    setKnowledgeConsumerWatermark('context-index', 'mail:work', 3, 4_000);
    setKnowledgeConsumerWatermark('context-index', 'mail:work', 2, 5_000);
    expect(getKnowledgeConsumerWatermark('context-index', 'mail:work')).toBe(3);
  });

  it('keeps identical external ids isolated across collection scopes', () => {
    const base = {
      sourceInstanceId: 'github:work',
      externalId: '123',
      itemType: 'development_activity',
      contentHash: 'hash-1',
    };
    const inventory = upsertKnowledgeSourceItems([{
      ...base,
      collectionScope: 'repositories',
    }]);
    const activity = upsertKnowledgeSourceItems([{
      ...base,
      collectionScope: 'authored-work',
    }]);

    expect(inventory.created).toBe(1);
    expect(activity.created).toBe(1);
    expect(activity.items[0]?.id).not.toBe(inventory.items[0]?.id);
    expect(listKnowledgeSourceItems({ sourceInstanceId: 'github:work' }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ collectionScope: 'repositories', externalId: '123' }),
        expect.objectContaining({ collectionScope: 'authored-work', externalId: '123' }),
      ]));
  });

  it('claims synthesis work with leases, retries, and ownership checks', () => {
    const [first, second] = upsertKnowledgeSourceItems([
      {
        sourceInstanceId: 'calendar:personal',
        collectionScope: 'events',
        externalId: 'event-1',
        itemType: 'calendar_event',
        contentHash: 'event-hash-1',
        normalizedText: 'Design review',
      },
      {
        sourceInstanceId: 'mail:work',
        collectionScope: 'messages',
        externalId: 'message-1',
        itemType: 'email',
        contentHash: 'mail-hash-1',
        normalizedText: 'Launch update',
      },
    ], 1_000).items;

    const claimed = claimKnowledgeSourceItems({
      workerId: 'worker-a',
      sourceInstanceId: 'calendar:personal',
      nowMs: 10_000,
    });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      id: first?.id,
      synthesisStatus: 'processing',
      synthesisAttempts: 1,
      synthesisClaimedBy: 'worker-a',
    });
    expect(completeKnowledgeSourceItemSynthesis({
      itemId: first!.id,
      workerId: 'worker-b',
      status: 'completed',
    })).toBe(false);
    expect(completeKnowledgeSourceItemSynthesis({
      itemId: first!.id,
      workerId: 'worker-a',
      status: 'completed',
    })).toBe(true);

    claimKnowledgeSourceItems({ workerId: 'worker-a', sourceInstanceId: 'mail:work', nowMs: 10_000 });
    const reclaimed = claimKnowledgeSourceItems({
      workerId: 'worker-b',
      sourceInstanceId: 'mail:work',
      leaseMs: 1_000,
      nowMs: 12_000,
    });
    expect(reclaimed[0]).toMatchObject({
      id: second?.id,
      synthesisAttempts: 2,
      synthesisClaimedBy: 'worker-b',
    });
    expect(completeKnowledgeSourceItemSynthesis({
      itemId: second!.id,
      workerId: 'worker-b',
      status: 'failed',
      error: 'temporary failure',
      nowMs: 12_000,
    })).toBe(true);
    expect(listKnowledgeSourceItems({ sourceInstanceId: 'mail:work' })[0]).toMatchObject({
      synthesisStatus: 'failed',
      synthesisError: 'temporary failure',
    });
    expect(claimKnowledgeSourceItems({
      workerId: 'worker-c',
      sourceInstanceId: 'mail:work',
      retryDelayMs: 30_000,
      nowMs: 12_001,
    })).toHaveLength(0);
    expect(claimKnowledgeSourceItems({
      workerId: 'worker-c',
      sourceInstanceId: 'mail:work',
      retryDelayMs: 30_000,
      nowMs: 50_000,
    })[0]).toMatchObject({ synthesisAttempts: 3, synthesisClaimedBy: 'worker-c' });
  });
});
