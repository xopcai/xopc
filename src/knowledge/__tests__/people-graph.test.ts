import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertKnowledgeSourceItems,
} from '../../storage/sqlite/index.js';
import { buildConnectedPeopleGraph } from '../people-graph.js';

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

  it('joins the same person across active sources and excludes deleted evidence', () => {
    const base = {
      itemType: 'conversation_message',
      contentHash: 'hash',
      normalizedText: 'Project update',
      synthesisPipeline: 'connected_knowledge' as const,
    };
    upsertKnowledgeSourceItems([
      {
        ...base,
        sourceInstanceId: 'composio:slack:work',
        externalId: 'message-1',
        metadata: {
          connectorId: 'composio-slack',
          toolkit: 'slack',
          personEntities: [{ role: 'author', name: 'Ada Lovelace', email: 'ADA@example.com' }],
        },
      },
      {
        ...base,
        sourceInstanceId: 'composio:gmail:work',
        externalId: 'message-2',
        metadata: {
          connectorId: 'composio-gmail',
          toolkit: 'gmail',
          personEntities: [{ role: 'sender', email: 'ada@example.com' }],
        },
      },
      {
        ...base,
        sourceInstanceId: 'composio:gmail:work',
        externalId: 'deleted-message',
        deletedAt: new Date().toISOString(),
        metadata: { personEntities: [{ role: 'sender', email: 'old@example.com' }] },
      },
    ]);

    const graph = buildConnectedPeopleGraph({ query: 'ada' });

    expect(graph.people).toEqual([
      expect.objectContaining({
        label: 'Ada Lovelace',
        names: ['Ada Lovelace'],
        emails: ['ada@example.com'],
        roles: ['author', 'sender'],
        mentionCount: 2,
      }),
    ]);
    expect(graph.sourceEdges).toHaveLength(2);
    expect(graph.sourceEdges.map((edge) => edge.toolkit).toSorted()).toEqual(['gmail', 'slack']);
  });
});
