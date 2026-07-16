import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  attachMemoryEvidence,
  closeXopcDatabase,
  getKnowledgeSourceCursor,
  listKnowledgeSourceItems,
  listMemoryEvidence,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
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

    setKnowledgeSourceCursor('calendar:personal', 'cursor-2');
    expect(getKnowledgeSourceCursor('calendar:personal')).toBe('cursor-2');

    const record = upsertMemoryRecord({
      providerId: 'local',
      kind: 'commitment',
      agentId: 'main',
      content: 'Attend the design review.',
    });
    attachMemoryEvidence({
      recordId: record.id,
      sourceItemId: first.items[0]?.id,
      excerpt: input.normalizedText,
      confidence: 0.9,
    });
    expect(listMemoryEvidence(record.id)[0]).toMatchObject({
      sourceItemId: first.items[0]?.id,
      relation: 'supports',
      confidence: 0.9,
    });
  });
});
