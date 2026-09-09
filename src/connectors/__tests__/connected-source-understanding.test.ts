import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { listKnowledgeItems } from '../../knowledge-memory/index.js';
import type { KnowledgeSourceItem } from '../../knowledge/types.js';
import {
  closeXopcDatabase,
  getSqliteDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertKnowledgeSourceItems,
} from '../../storage/sqlite/index.js';
import {
  createUnderstandingSourceRun,
  upsertUnderstandingSourceGrant,
} from '../../user-context/sources/repository.js';
import { listUserAssertions, listUserAssertionSources } from '../../user-model/index.js';
import {
  connectedItemsForUnderstanding,
  deriveConnectedSourceUnderstanding,
} from '../connected-source-understanding.js';

function item(overrides: Partial<KnowledgeSourceItem>): KnowledgeSourceItem {
  return {
    id: 'item-1', sourceInstanceId: 'composio:gmail:account-1', collectionScope: 'messages',
    externalId: 'mail-1', itemType: 'email', contentHash: 'hash',
    normalizedText: JSON.stringify({ subject: 'Atlas launch', content: 'Prepare the launch review.' }),
    metadata: { toolkit: 'gmail', agentId: 'main', actorAttributed: false },
    sensitivity: 'personal', retentionClass: 'bounded', synthesisPipeline: 'connected_knowledge',
    synthesisStatus: 'pending', synthesisAttempts: 0,
    createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('connected source understanding', () => {
  let stateDirectory: string;

  beforeEach(() => {
    stateDirectory = mkdtempSync(join(tmpdir(), 'xopc-connected-understanding-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDirectory, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDirectory, { recursive: true, force: true });
  });

  it('prioritizes explicitly read content and preserves attribution', () => {
    const values = connectedItemsForUnderstanding([
      item({ id: 'metadata', normalizedText: JSON.stringify({ subject: 'Metadata only' }) }),
      item({ id: 'content', itemType: 'connected_content',
        normalizedText: JSON.stringify({ title: 'Detailed brief', content: 'Full brief body' }),
        metadata: { toolkit: 'drive', agentId: 'main', actorAttributed: true } }),
    ]);
    expect(values.map((value) => value.id)).toEqual(['content', 'metadata']);
    expect(values[0]).toMatchObject({ ownerAttribution: 'user', evidenceRef: 'knowledge-source://content' });
  });

  it('keeps current responsibilities in knowledge instead of the durable user model', async () => {
    const { sourceInstanceId, sourceRunId, processingPolicy } = sourceContext('gmail');
    upsertKnowledgeSourceItems([sourceRow(sourceInstanceId, 1, false)]);
    const result = await deriveConnectedSourceUnderstanding({
      config: ConfigSchema.parse({}), agentId: 'main', sourceInstanceId, sourceRunId, processingPolicy,
      analyze: vi.fn(async ({ items }) => ({
        modelRef: 'test/model', profileCandidates: [{
          id: 'responsibility', category: 'responsibility', factKey: 'atlas',
          statement: 'Owns the Atlas launch review.', confidence: 'high', evidence: ['assigned'],
          evidenceRefs: [items[0]!.evidenceRef], status: 'pending',
        }],
        workThreadCandidates: [{ topicKey: 'atlas', title: 'Atlas launch', summary: 'Review in progress.',
          horizon: 'current', status: 'active', confidence: 'high', evidenceRefs: [items[0]!.evidenceRef] }],
        sourceStatuses: [{ sourceId: 'connected-work', status: 'completed' }],
      })),
    });
    expect(result).toEqual({ created: 0, knowledgeCount: 1, status: 'completed' });
    expect(listUserAssertions()).toEqual([]);
    expect(listKnowledgeItems()).toEqual([expect.objectContaining({ content: 'Atlas launch: Review in progress.' })]);
  });

  it('creates only repeated owner-backed durable assertions with separate evidence', async () => {
    const { sourceInstanceId, sourceRunId, processingPolicy } = sourceContext('slack');
    upsertKnowledgeSourceItems([1, 2, 3].map((index) => sourceRow(sourceInstanceId, index, true)));
    const result = await deriveConnectedSourceUnderstanding({
      config: ConfigSchema.parse({}), agentId: 'main', sourceInstanceId, sourceRunId, processingPolicy,
      analyze: vi.fn(async ({ items }) => ({
        modelRef: 'test/model',
        profileCandidates: [{
          id: 'routine', category: 'routine', factKey: 'weekly-planning', statement: 'Plans work weekly.',
          confidence: 'high', evidence: ['repeated'], evidenceRefs: items.map((value) => value.evidenceRef),
          status: 'pending',
        }],
        workThreadCandidates: [], sourceStatuses: [{ sourceId: 'connected-work', status: 'completed' }],
      })),
    });
    expect(result).toEqual({ created: 1, knowledgeCount: 0, status: 'completed' });
    const [assertion] = listUserAssertions();
    expect(assertion).toMatchObject({
      statement: 'Plans work weekly.',
      authority: 'user_observed',
    });
    expect(getSqliteDatabase().prepare(`SELECT scope_type FROM user_assertion_slots
      WHERE slot_id = ?`).get(assertion!.slotId)).toEqual({ scope_type: 'global' });
    expect(listUserAssertionSources([assertion!.id]).get(assertion!.id)).toEqual([expect.objectContaining({
      id: 'connector:slack',
      kind: 'connector',
      label: 'slack',
    })]);
    expect(getSqliteDatabase().prepare(
      'SELECT COUNT(*) AS count FROM user_assertion_evidence WHERE assertion_id = ?',
    ).get(assertion!.id)).toEqual({ count: 3 });
  });

  it('does not send local-only source content to semantic analysis', async () => {
    const analyze = vi.fn();
    upsertKnowledgeSourceItems([sourceRow('local:notes', 1, true)]);
    expect(await deriveConnectedSourceUnderstanding({
      config: ConfigSchema.parse({}), agentId: 'main', sourceInstanceId: 'local:notes',
      sourceRunId: 'run-local', processingPolicy: 'local_only', analyze,
    })).toEqual({ created: 0, knowledgeCount: 0, status: 'completed' });
    expect(analyze).not.toHaveBeenCalled();
  });
});

function sourceContext(kind: string) {
  const sourceInstanceId = `composio:${kind}:account-1`;
  const grant = upsertUnderstandingSourceGrant({
    sourceKey: `connector-account:${kind}`, adapterId: `connector:${kind}`, category: 'files',
    platform: 'all', displayName: kind, accessMode: 'continuous', retentionPolicy: 'bounded_raw',
    processingPolicy: 'remote_allowed', config: { sourceInstanceId },
  });
  const run = createUnderstandingSourceRun({ grantId: grant.id, kind: 'bootstrap' });
  return { sourceInstanceId, sourceRunId: run.id, processingPolicy: grant.processingPolicy };
}

function sourceRow(sourceInstanceId: string, index: number, owner: boolean) {
  return {
    sourceInstanceId, collectionScope: 'messages', externalId: `message-${index}`,
    itemType: 'connected_content' as const, occurredAt: `2026-08-${20 + index}T09:00:00.000Z`,
    contentHash: `hash-${index}`, normalizedText: JSON.stringify({ title: `Planning ${index}` }),
    metadata: { toolkit: 'source', agentId: 'main', actorAttributed: owner },
    sensitivity: 'personal' as const, retentionClass: 'bounded' as const,
    synthesisPipeline: 'connected_knowledge' as const, synthesisStatus: 'pending' as const,
  };
}
