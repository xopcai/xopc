import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getKnowledgeItem, listKnowledgeItems } from '../../knowledge-memory/index.js';
import {
  closeXopcDatabase,
  listKnowledgeSourceItems,
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
      agentId: 'main', workspaceId: '/workspace', workerId: 'test-worker',
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('turns bounded source content into a scoped, traceable source index', async () => {
    const [source] = upsertKnowledgeSourceItems([{
      sourceInstanceId: 'composio:gmail:work', collectionScope: 'messages', externalId: 'message-1',
      itemType: 'gmail:message', occurredAt: '2026-07-20T08:30:00.000Z', contentHash: 'hash-1',
      normalizedText: 'Quarterly planning review is on Tuesday at 10:00.',
      metadata: { connectorId: 'gmail', agentId: 'main', workspaceId: '/workspace' },
      sensitivity: 'personal', synthesisPipeline: 'connected_knowledge',
    }]).items;

    const result = await pipeline.processPending('composio:gmail:work');
    expect(result).toMatchObject({ claimed: 1, completed: 1, ignored: 0, failed: 0 });
    expect(getKnowledgeItem(result.recordIds[0]!)).toMatchObject({
      kind: 'workspace_fact', status: 'active', scope: { type: 'workspace', id: '/workspace' },
      recordClass: 'source_index', originClass: 'untrusted',
      source: { provider: 'gmail', sourceItemId: source!.id },
    });
    expect(listKnowledgeItems().some((item) => item.canonicalKey.startsWith('source-day:'))).toBe(false);
  });

  it('updates stable knowledge and archives it when the source is deleted', async () => {
    const base = {
      sourceInstanceId: 'composio:notion:personal', collectionScope: 'pages', externalId: 'page-1',
      itemType: 'notion:page', occurredAt: '2026-07-19T12:00:00.000Z',
      metadata: { connectorId: 'notion' }, synthesisPipeline: 'connected_knowledge' as const,
    };
    upsertKnowledgeSourceItems([{ ...base, contentHash: 'hash-1', normalizedText: 'Checklist is ready.' }]);
    const first = await pipeline.processPending(base.sourceInstanceId);
    const knowledgeId = first.recordIds[0]!;
    upsertKnowledgeSourceItems([{ ...base, contentHash: 'hash-2', normalizedText: 'Checklist is approved.' }]);
    await pipeline.processPending(base.sourceInstanceId);
    expect(getKnowledgeItem(knowledgeId)?.content).toBe('Checklist is approved.');

    upsertKnowledgeSourceItems([{
      ...base, contentHash: 'hash-2', normalizedText: 'Checklist is approved.',
      deletedAt: '2026-07-20T09:00:00.000Z',
    }]);
    await pipeline.processPending(base.sourceInstanceId);
    expect(getKnowledgeItem(knowledgeId)?.status).toBe('archived');
  });

  it('prunes expired bounded source rows and archives derived knowledge', async () => {
    const sourceInstanceId = 'composio:gmail:retention';
    upsertKnowledgeSourceItems([{
      sourceInstanceId, collectionScope: 'messages', externalId: 'old-message', itemType: 'gmail:message',
      occurredAt: '2026-06-01T08:00:00.000Z', contentHash: 'old-hash',
      normalizedText: 'Old bounded content.', metadata: { connectorId: 'gmail' },
      synthesisPipeline: 'connected_knowledge',
    }]);
    const processed = await pipeline.processPending(sourceInstanceId);
    const result = pipeline.pruneBoundedRetention(sourceInstanceId, Date.parse('2026-07-01T00:00:00.000Z'));
    expect(result).toEqual({ rawDeleted: 1, derivedDeleted: 1 });
    expect(listKnowledgeSourceItems({ sourceInstanceId })).toEqual([]);
    expect(getKnowledgeItem(processed.recordIds[0]!)?.status).toBe('archived');
  });
});
