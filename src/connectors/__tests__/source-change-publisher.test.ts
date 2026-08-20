import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProactiveEventService } from '../../proactive/service.js';
import { upsertConnectorConnection } from '../../storage/sqlite/connector-repository.js';
import { upsertConnectorSyncPolicy } from '../../storage/sqlite/connector-sync-policy-repository.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { upsertKnowledgeSourceItems } from '../../storage/sqlite/knowledge-repository.js';
import { ConnectedSourceChangePublisher } from '../source-change-publisher.js';

describe('connected source change publisher', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-source-changes-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    upsertConnectorConnection({
      id: 'connection-1',
      connectorId: 'gmail',
      provider: 'composio',
      principalId: 'local-owner',
      providerConnectionId: 'provider-1',
      identity: {},
      status: 'active',
      isDefault: true,
      metadata: {},
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  function sourceItem(
    contentHash: string,
    deletedAt?: string,
    sensitivity: 'personal' | 'secret' = 'personal',
  ) {
    return {
      sourceInstanceId: 'composio:gmail:account:connection-1',
      collectionScope: 'messages',
      externalId: 'message-1',
      itemType: 'message',
      occurredAt: '2026-08-15T01:00:00.000Z',
      sourceUpdatedAt: '2026-08-15T01:00:00.000Z',
      contentHash,
      normalizedText: 'private message body',
      metadata: {
        connectorId: 'gmail',
        connectionId: 'connection-1',
        workspaceId: '/workspace',
        agentId: 'main',
      },
      sensitivity,
      retentionClass: 'bounded' as const,
      synthesisPipeline: 'connected_knowledge' as const,
      synthesisStatus: 'pending' as const,
      ...(deletedAt ? { deletedAt } : {}),
    };
  }

  it('publishes one durable event per actual source change without raw content', async () => {
    upsertConnectorSyncPolicy({ accountId: 'account:connection-1', proactiveEnabled: true });
    upsertKnowledgeSourceItems([sourceItem('hash-1')], Date.parse('2026-08-15T01:00:00.000Z'));
    upsertKnowledgeSourceItems([sourceItem('hash-1')], Date.parse('2026-08-15T01:01:00.000Z'));
    upsertKnowledgeSourceItems([sourceItem('hash-2')], Date.parse('2026-08-15T01:02:00.000Z'));
    upsertKnowledgeSourceItems(
      [sourceItem('deleted', '2026-08-15T01:03:00.000Z')],
      Date.parse('2026-08-15T01:03:00.000Z'),
    );

    const events = new ProactiveEventService(() => []);
    const publisher = new ConnectedSourceChangePublisher(events);
    const first = await publisher.runNow();
    const duplicate = await publisher.runNow();

    expect(first).toMatchObject({ published: 3, skipped: 0 });
    expect(duplicate).toMatchObject({ published: 0, skipped: 0 });
    expect(events.listEvents().map((event) => event.type).sort()).toEqual([
      'connected_source.item_created.v1',
      'connected_source.item_deleted.v1',
      'connected_source.item_updated.v1',
    ]);
    expect(JSON.stringify(events.listEvents())).not.toContain('private message body');
  });

  it('advances the independent watermark while proactive use is disabled', async () => {
    upsertConnectorSyncPolicy({ accountId: 'account:connection-1', proactiveEnabled: false });
    upsertKnowledgeSourceItems([sourceItem('hash-1')]);
    const events = new ProactiveEventService(() => []);
    const publisher = new ConnectedSourceChangePublisher(events);

    expect(await publisher.runNow()).toMatchObject({ published: 0, skipped: 1 });
    upsertConnectorSyncPolicy({ accountId: 'account:connection-1', proactiveEnabled: true });
    expect(await publisher.runNow()).toMatchObject({ published: 0, skipped: 0 });
    expect(events.listEvents()).toHaveLength(0);
  });

  it('does not publish secret source content into the proactive event spine', async () => {
    upsertConnectorSyncPolicy({ accountId: 'account:connection-1', proactiveEnabled: true });
    upsertKnowledgeSourceItems([sourceItem('hash-secret', undefined, 'secret')]);
    const events = new ProactiveEventService(() => []);

    expect(await new ConnectedSourceChangePublisher(events).runNow())
      .toMatchObject({ published: 0, skipped: 1 });
    expect(events.listEvents()).toHaveLength(0);
  });
});
