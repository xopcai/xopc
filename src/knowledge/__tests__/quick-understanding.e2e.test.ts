import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  listUnderstandings,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertKnowledgeSourceItems,
} from '../../storage/sqlite/index.js';
import { ConnectedKnowledgePipeline } from '../connected-knowledge-pipeline.js';

describe('quick understanding end to end', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-quick-understanding-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('keeps connected activity searchable without promoting it into the user portrait', async () => {
    const base = {
      collectionScope: 'activity',
      authorRole: 'third_party' as const,
      sensitivity: 'personal' as const,
      retentionClass: 'bounded' as const,
      synthesisPipeline: 'connected_knowledge' as const,
      synthesisStatus: 'pending' as const,
    };
    const stored = upsertKnowledgeSourceItems([
      {
        ...base,
        sourceInstanceId: 'composio:composio-gmail:work', externalId: 'mail-atlas', itemType: 'email',
        occurredAt: '2026-08-24T09:00:00.000Z', contentHash: 'mail-atlas',
        normalizedText: JSON.stringify({ subject: 'Re: Atlas launch review' }),
        metadata: {
          connectorId: 'composio-gmail', toolkit: 'gmail', agentId: 'main', workspaceId: stateDir,
          observationKind: 'message', actorAttributed: true, logicalEventKey: 'gmail:atlas',
        },
      },
      {
        ...base,
        sourceInstanceId: 'composio:composio-googlecalendar:work', externalId: 'calendar-atlas', itemType: 'calendar_event',
        occurredAt: '2026-08-24T10:00:00.000Z', contentHash: 'calendar-atlas',
        normalizedText: JSON.stringify({ title: 'Atlas launch review' }),
        metadata: {
          connectorId: 'composio-googlecalendar', toolkit: 'googlecalendar', agentId: 'main', workspaceId: stateDir,
          observationKind: 'calendar_event', actorAttributed: true, logicalEventKey: 'calendar:atlas',
        },
      },
      {
        ...base,
        sourceInstanceId: 'composio:composio-github:work', externalId: 'github-atlas', itemType: 'development_activity',
        occurredAt: '2026-08-25T09:00:00.000Z', contentHash: 'github-atlas',
        normalizedText: JSON.stringify({ title: 'Atlas launch review implementation', repository: 'xopc/atlas' }),
        metadata: {
          connectorId: 'composio-github', toolkit: 'github', agentId: 'main', workspaceId: stateDir,
          observationKind: 'activity', actorAttributed: true, logicalEventKey: 'github:atlas', subjectKey: 'xopc/atlas',
        },
      },
    ]).items;

    const knowledge = new ConnectedKnowledgePipeline({ agentId: 'main', workspaceId: stateDir });
    expect((await knowledge.processPending()).completed).toBe(3);

    expect(stored).toHaveLength(3);
    expect(listUnderstandings()).toEqual([]);
  });
});
