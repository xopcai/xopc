import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  getMemoryRecord,
  listKnowledgeSourceChanges,
  listKnowledgeSourceItems,
  listMemoryEvidence,
  listMemoryRecords,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertKnowledgeSourceItems,
} from '../../storage/sqlite/index.js';
import { ConnectedKnowledgePipeline } from '../connected-knowledge-pipeline.js';

describe('ConnectedKnowledgePipeline', () => {
  let stateDir: string;
  let pipeline: ConnectedKnowledgePipeline;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-connected-knowledge-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    pipeline = new ConnectedKnowledgePipeline({
      agentId: 'main',
      workspaceId: '/workspace',
      workerId: 'test-worker',
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('turns normalized source items into active, cited knowledge and daily summaries', async () => {
    const [item] = upsertKnowledgeSourceItems([{
      sourceInstanceId: 'composio:composio-gmail:gmail-work',
      externalId: 'message-1',
      itemType: 'gmail:message',
      occurredAt: '2026-07-20T08:30:00.000Z',
      contentHash: 'hash-1',
      normalizedText: 'Quarterly planning review is on Tuesday at 10:00.',
      metadata: {
        connectorId: 'composio-gmail',
        agentId: 'main',
        workspaceId: '/workspace',
      },
      sensitivity: 'personal',
      synthesisPipeline: 'connected_knowledge',
    }]).items;

    const result = await pipeline.processPending('composio:composio-gmail:gmail-work');

    expect(result).toMatchObject({ claimed: 1, completed: 1, ignored: 0, failed: 0 });
    const record = getMemoryRecord(result.recordIds[0]!);
    expect(record).toMatchObject({
      id: `knowledge:${item!.id}`,
      kind: 'workspace_fact',
      status: 'active',
      sensitivity: 'personal',
      source: { provider: 'composio-gmail' },
      scope: { agentId: 'main', workspaceId: '/workspace' },
      evidence: [expect.objectContaining({ sourceItemId: item!.id, relation: 'derived_from' })],
    });
    expect(listMemoryEvidence(record!.id)).toEqual([
      expect.objectContaining({ sourceItemId: item!.id, relation: 'derived_from' }),
    ]);
    const [summary] = listMemoryRecords({ providerId: 'connected-knowledge', kind: 'daily_note' });
    expect(summary).toMatchObject({ status: 'active', sensitivity: 'personal' });
    expect(summary?.evidence).toEqual([
      expect.objectContaining({ sourceItemId: item!.id, relation: 'derived_from' }),
    ]);
    expect(summary?.content).toContain('Quarterly planning review');
    expect(listMemoryEvidence(summary!.id)[0]).toMatchObject({
      sourceItemId: item!.id,
      relation: 'derived_from',
    });
    expect(listKnowledgeSourceItems()[0]).toMatchObject({
      synthesisStatus: 'completed',
      synthesisAttempts: 1,
    });
  });

  it('updates stable records, ignores restricted content, and archives deleted knowledge', async () => {
    const sourceInstanceId = 'composio:composio-notion:notion-personal';
    const [item] = upsertKnowledgeSourceItems([{
      sourceInstanceId,
      externalId: 'page-1',
      itemType: 'notion:page',
      occurredAt: '2026-07-19T12:00:00.000Z',
      contentHash: 'hash-1',
      normalizedText: 'The launch checklist is ready.',
      metadata: { connectorId: 'composio-notion' },
      synthesisPipeline: 'connected_knowledge',
    }, {
      sourceInstanceId,
      externalId: 'secret-1',
      itemType: 'notion:page',
      contentHash: 'secret-hash',
      normalizedText: 'credential material',
      metadata: { connectorId: 'composio-notion' },
      synthesisPipeline: 'connected_knowledge',
      sensitivity: 'secret',
    }]).items;
    const first = await pipeline.processPending(sourceInstanceId);
    expect(first).toMatchObject({ completed: 1, ignored: 1 });
    const recordId = `knowledge:${item!.id}`;

    upsertKnowledgeSourceItems([{
      sourceInstanceId,
      externalId: 'page-1',
      itemType: 'notion:page',
      occurredAt: '2026-07-19T12:00:00.000Z',
      contentHash: 'hash-2',
      normalizedText: 'The launch checklist is ready and approved.',
      metadata: { connectorId: 'composio-notion' },
      synthesisPipeline: 'connected_knowledge',
    }]);
    await pipeline.processPending(sourceInstanceId);
    expect(getMemoryRecord(recordId)).toMatchObject({
      id: recordId,
      content: 'The launch checklist is ready and approved.',
      status: 'active',
    });
    expect(listMemoryEvidence(recordId)).toHaveLength(1);

    upsertKnowledgeSourceItems([{
      sourceInstanceId,
      externalId: 'page-1',
      itemType: 'notion:page',
      occurredAt: '2026-07-19T12:00:00.000Z',
      contentHash: 'hash-2',
      normalizedText: 'The launch checklist is ready and approved.',
      metadata: { connectorId: 'composio-notion' },
      synthesisPipeline: 'connected_knowledge',
      deletedAt: '2026-07-20T09:00:00.000Z',
    }]);
    await pipeline.processPending(sourceInstanceId);

    expect(getMemoryRecord(recordId)?.status).toBe('archived');
    expect(listKnowledgeSourceChanges({ sourceInstanceId }).map((change) => change.kind))
      .toEqual(['added', 'added', 'modified', 'deleted']);
    expect(listMemoryRecords({ providerId: 'connected-knowledge', kind: 'daily_note' })[0]?.status)
      .toBe('archived');
  });
});
