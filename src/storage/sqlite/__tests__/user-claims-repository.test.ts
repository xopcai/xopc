import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  listUserClaimEvidence,
  listUserClaims,
  openXopcDatabase,
  removeUserClaimEvidenceForSource,
  reinforceUserClaim,
  resetXopcDatabaseSingletonForTest,
  resolveUserEntity,
  setUserClaimDecision,
  upsertKnowledgeSourceItems,
} from '../index.js';

describe('user claims repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-user-claims-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('joins verified handles but never merges display names across sources', () => {
    const byEmail = resolveUserEntity({
      type: 'person', canonicalLabel: 'Ada Lovelace',
      handles: [{ type: 'email', value: 'ADA@example.com', sourceScope: 'global', verified: true }],
    });
    const sameEmail = resolveUserEntity({
      type: 'person', canonicalLabel: 'Ada',
      handles: [{ type: 'email', value: 'ada@example.com', sourceScope: 'global', verified: true }],
    });
    const sameNameElsewhere = resolveUserEntity({
      type: 'person', canonicalLabel: 'Ada Lovelace',
      handles: [{ type: 'display_name', value: 'Ada Lovelace', sourceScope: 'slack:other', verified: false }],
    });
    expect(sameEmail.id).toBe(byEmail.id);
    expect(sameNameElsewhere.id).not.toBe(byEmail.id);
  });

  it('counts unique logical events and preserves rejection across reinforcement', () => {
    const items = upsertKnowledgeSourceItems([
      ['event-1', '2026-08-01T09:00:00.000Z'],
      ['event-2', '2026-08-01T10:00:00.000Z'],
      ['event-3', '2026-08-02T09:00:00.000Z'],
    ].map(([externalId, occurredAt]) => ({
      sourceInstanceId: 'composio:github:work', collectionScope: 'authored-work', externalId: externalId!,
      itemType: 'development_activity', occurredAt, contentHash: externalId!,
    }))).items;
    const evidence = items.map((item) => ({
      logicalEventKey: `github:${item.externalId}`,
      sourceItemId: item.id,
      sourceInstanceId: item.sourceInstanceId,
      relation: 'supports' as const,
      observedAt: item.occurredAt!,
    }));
    const first = reinforceUserClaim({
      agentId: 'main', class: 'project', key: 'project:one', value: { label: 'xopcai/xopc' }, evidence,
    });
    expect(first).toMatchObject({ state: 'active', independentEvidenceCount: 3, activeDayCount: 2 });
    const repeated = reinforceUserClaim({
      agentId: 'main', class: 'project', key: 'project:one', value: { label: 'xopcai/xopc' }, evidence,
    });
    expect(repeated.independentEvidenceCount).toBe(3);
    expect(listUserClaimEvidence(first.id)).toHaveLength(3);
    expect(setUserClaimDecision(first.id, 'rejected')).toMatchObject({ state: 'rejected' });
    expect(reinforceUserClaim({
      agentId: 'main', class: 'project', key: 'project:one', value: { label: 'xopcai/xopc' }, evidence,
    })).toMatchObject({ state: 'rejected', userState: 'rejected' });
  });

  it('removes only one source evidence and deletes claims only after all evidence is gone', () => {
    const sourceA = 'composio:github:work';
    const sourceB = 'composio:gmail:work';
    const items = upsertKnowledgeSourceItems([
      { sourceInstanceId: sourceA, collectionScope: 'authored-work', externalId: 'event-1',
        itemType: 'development_activity', occurredAt: '2026-08-01T09:00:00.000Z', contentHash: 'event-1' },
      { sourceInstanceId: sourceB, collectionScope: 'messages', externalId: 'event-2',
        itemType: 'email', occurredAt: '2026-08-01T10:00:00.000Z', contentHash: 'event-2' },
      { sourceInstanceId: sourceB, collectionScope: 'messages', externalId: 'event-3',
        itemType: 'email', occurredAt: '2026-08-02T09:00:00.000Z', contentHash: 'event-3' },
      { sourceInstanceId: sourceB, collectionScope: 'messages', externalId: 'event-4',
        itemType: 'email', occurredAt: '2026-08-02T10:00:00.000Z', contentHash: 'event-4' },
    ]).items;
    const claim = reinforceUserClaim({
      agentId: 'main', class: 'project', key: 'project:shared', value: { label: 'xopcai/xopc' },
      evidence: items.map((item) => ({
        logicalEventKey: `${item.sourceInstanceId}:${item.externalId}`,
        sourceItemId: item.id,
        sourceInstanceId: item.sourceInstanceId,
        relation: 'supports' as const,
        observedAt: item.occurredAt!,
      })),
    });
    expect(claim.state).toBe('active');

    expect(removeUserClaimEvidenceForSource(sourceA)).toMatchObject({ deletedClaimCount: 0 });
    expect(listUserClaims()).toMatchObject([{ state: 'active', independentEvidenceCount: 3 }]);
    expect(listUserClaimEvidence(claim.id)).toHaveLength(3);

    expect(removeUserClaimEvidenceForSource(sourceB)).toMatchObject({ deletedClaimCount: 1 });
    expect(listUserClaims()).toEqual([]);
  });
});
