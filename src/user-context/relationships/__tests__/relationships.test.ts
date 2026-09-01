import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertKnowledgeSourceItems,
} from '../../../storage/sqlite/index.js';
import {
  listUserRelationships,
  mergeUserRelationships,
  patchUserRelationship,
} from '../service.js';
import { buildUserPeopleIndex, rebuildUserPeopleIndex } from '../indexer.js';
import {
  revokeUnderstandingSourceGrant,
  upsertUnderstandingSourceGrant,
} from '../../sources/repository.js';
import type { KnowledgeSourceItem } from '../../../knowledge/types.js';

function item(id: string, patch: Partial<KnowledgeSourceItem> = {}): KnowledgeSourceItem {
  return {
    id,
    sourceInstanceId: 'composio:composio-gmail:work',
    collectionScope: 'messages',
    externalId: id,
    itemType: 'email',
    occurredAt: '2026-08-01T09:00:00.000Z',
    contentHash: id,
    metadata: { personEntities: [] },
    sensitivity: 'personal',
    retentionClass: 'bounded',
    synthesisPipeline: 'connected_knowledge',
    synthesisStatus: 'completed',
    synthesisAttempts: 1,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    ...patch,
  };
}

describe('user relationships', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-user-relationships-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('merges strong email identities, excludes the owner, and classifies automation', () => {
    const entries = buildUserPeopleIndex([
      item('mail-1', { metadata: {
        ownerIdentities: ['owner@example.com'],
        personEntities: [
          { name: 'Alex Chen', email: 'alex@example.com' },
          { name: 'Owner', email: 'owner@example.com' },
          { email: 'notifications@github.com' },
        ],
      } }),
      item('mail-2', {
        sourceInstanceId: 'composio:composio-slack:work',
        metadata: { personEntities: [{ name: 'Alex C.', email: 'ALEX@example.com' }, { username: 'merge-queue[bot]' }] },
      }),
    ]);

    expect(entries).toHaveLength(3);
    expect(entries.find((entry) => entry.displayName === 'Alex Chen')).toMatchObject({
      inferredKind: 'person',
      sources: expect.arrayContaining([
        expect.objectContaining({ sourceInstanceId: 'composio:composio-gmail:work' }),
        expect.objectContaining({ sourceInstanceId: 'composio:composio-slack:work' }),
      ]),
    });
    expect(entries.find((entry) => entry.displayName === 'notifications@github.com')?.inferredKind).toBe('service');
    expect(entries.find((entry) => entry.displayName === 'merge-queue[bot]')?.inferredKind).toBe('bot');
    expect(entries.some((entry) => entry.displayName === 'Owner')).toBe(false);
  });

  it('indexes only active connector sources and preserves user corrections across rebuilds', () => {
    const grant = upsertUnderstandingSourceGrant({
      sourceKey: 'connector-account:work',
      adapterId: 'connector:composio-gmail',
      category: 'mail',
      platform: 'all',
      displayName: 'Gmail',
      accessMode: 'continuous',
      retentionPolicy: 'bounded_raw',
      processingPolicy: 'local_only',
      config: { connectorId: 'composio-gmail', accountId: 'work' },
    });
    upsertKnowledgeSourceItems([{
      sourceInstanceId: 'composio:composio-gmail:work',
      collectionScope: 'messages',
      externalId: 'mail-1',
      itemType: 'email',
      occurredAt: '2026-08-01T09:00:00.000Z',
      contentHash: 'mail-1',
      metadata: { personEntities: [{ name: 'Alex Chen', email: 'alex@example.com' }] },
      sensitivity: 'personal',
      retentionClass: 'bounded',
      synthesisPipeline: 'connected_knowledge',
      synthesisStatus: 'completed',
    }]);

    const first = listUserRelationships({ kind: 'person' });
    expect(first.summary).toMatchObject({ people: 1, sources: 1 });
    expect(first.items).toHaveLength(1);
    const personId = first.items[0]!.id;
    expect(patchUserRelationship(personId, { displayName: 'Alex', kind: 'group' })).toMatchObject({
      displayName: 'Alex', kind: 'group',
    });
    expect(listUserRelationships({ kind: 'group' }).items[0]).toMatchObject({
      id: personId, displayName: 'Alex', kind: 'group',
    });

    revokeUnderstandingSourceGrant(grant.id);
    expect(listUserRelationships().items).toEqual([]);
    expect(listUserRelationships().summary.people).toBe(0);
  });

  it('keeps a user merge stable when the derived index is rebuilt', () => {
    upsertUnderstandingSourceGrant({
      sourceKey: 'connector-account:work', adapterId: 'connector:composio-gmail', category: 'mail',
      platform: 'all', displayName: 'Gmail', accessMode: 'continuous', retentionPolicy: 'bounded_raw',
      processingPolicy: 'local_only', config: { connectorId: 'composio-gmail', accountId: 'work' },
    });
    upsertKnowledgeSourceItems([
      {
        sourceInstanceId: 'composio:composio-gmail:work', collectionScope: 'messages', externalId: 'mail-1',
        itemType: 'email', occurredAt: '2026-08-01T09:00:00.000Z', contentHash: 'mail-1',
        metadata: { personEntities: [{ name: 'Alex Chen', email: 'alex@example.com' }] },
        sensitivity: 'personal', retentionClass: 'bounded', synthesisPipeline: 'connected_knowledge', synthesisStatus: 'completed',
      },
      {
        sourceInstanceId: 'composio:composio-gmail:work', collectionScope: 'messages', externalId: 'mail-2',
        itemType: 'email', occurredAt: '2026-08-02T09:00:00.000Z', contentHash: 'mail-2',
        metadata: { personEntities: [{ name: 'Alex C.', email: 'alex.alt@example.com' }] },
        sensitivity: 'personal', retentionClass: 'bounded', synthesisPipeline: 'connected_knowledge', synthesisStatus: 'completed',
      },
    ]);
    const before = listUserRelationships({ kind: 'person' });
    expect(before.items).toHaveLength(2);
    expect(mergeUserRelationships(before.items[1]!.id, before.items[0]!.id)?.interactionCount).toBe(2);
    rebuildUserPeopleIndex();
    const afterRebuild = listUserRelationships({ kind: 'person' });
    expect(afterRebuild.items).toHaveLength(1);
    expect(afterRebuild.items[0]?.interactionCount).toBe(2);
  });
});
