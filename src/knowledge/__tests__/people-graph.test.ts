import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import type { MemoryManager } from '../../agent/memory/manager.js';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertKnowledgeSourceItems,
} from '../../storage/sqlite/index.js';
import { buildConnectedPeopleGraph } from '../people-graph.js';
import { ConnectedUnderstandingPipeline } from '../connected-understanding-pipeline.js';

describe('connected people graph', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-people-graph-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('joins the same verified person across active sources and excludes deleted evidence', async () => {
    const base = {
      itemType: 'conversation_message',
      contentHash: 'hash',
      normalizedText: 'Project update',
      occurredAt: '2026-08-04T09:00:00.000Z',
      synthesisPipeline: 'connected_knowledge' as const,
    };
    upsertKnowledgeSourceItems([
      {
        ...base,
        sourceInstanceId: 'composio:composio-slack:work',
        collectionScope: 'messages',
        externalId: 'message-1',
        metadata: {
          connectorId: 'composio-slack',
          toolkit: 'slack',
          actorAttributed: true,
          logicalEventKey: 'slack:message-1',
          personEntities: [{ role: 'author', name: 'Ada Lovelace', email: 'ADA@example.com' }],
        },
      },
      {
        ...base,
        sourceInstanceId: 'composio:composio-gmail:work',
        collectionScope: 'messages',
        externalId: 'message-2',
        metadata: {
          connectorId: 'composio-gmail',
          toolkit: 'gmail',
          actorAttributed: true,
          logicalEventKey: 'gmail:message-2',
          personEntities: [{ role: 'sender', email: 'ada@example.com' }],
        },
      },
      {
        ...base,
        sourceInstanceId: 'composio:composio-gmail:work',
        collectionScope: 'messages',
        externalId: 'deleted-message',
        deletedAt: new Date().toISOString(),
        metadata: { personEntities: [{ role: 'sender', email: 'old@example.com' }] },
      },
    ]);

    const manager = { applyUnderstandingCandidates: vi.fn() } as unknown as MemoryManager;
    const pipeline = new ConnectedUnderstandingPipeline(manager);
    await pipeline.process('composio:composio-slack:work', 'composio-slack', 'main');
    await pipeline.process('composio:composio-gmail:work', 'composio-gmail', 'main');

    const graph = buildConnectedPeopleGraph({ query: 'ada' });

    expect(graph.people).toEqual([
      expect.objectContaining({
        label: 'Ada Lovelace',
        names: ['Ada Lovelace'],
        emails: ['ada@example.com'],
        roles: [],
        mentionCount: 2,
      }),
    ]);
    expect(graph.sourceEdges).toHaveLength(2);
    expect(graph.sourceEdges.map((edge) => edge.toolkit).toSorted()).toEqual(['gmail', 'slack']);
  });
});
