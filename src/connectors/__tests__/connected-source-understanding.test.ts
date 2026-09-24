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
  listContextExtractionOutputs,
  listContextExtractionRuns,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertKnowledgeSourceItems,
} from '../../storage/sqlite/index.js';
import {
  createUnderstandingSourceRun,
  upsertUnderstandingSourceGrant,
} from '../../user-context/sources/repository.js';
import { grantUnderstandingConsent } from '../../user-context/sources/consent-repository.js';
import { listUserAssertions, listUserAssertionSources, listUserModelObservations } from '../../user-model/index.js';
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

  it('sends only consented fields to semantic analysis', async () => {
    const { sourceInstanceId, sourceRunId, processingPolicy } = sourceContext('gmail', ['title', 'owner_activity']);
    const sourceItemIds = upsertKnowledgeSourceItems([{
      ...sourceRow(sourceInstanceId, 1, true),
      normalizedText: JSON.stringify({ title: 'Planning', content: 'private body', token: 'never-send' }),
    }]).changedItemIds;
    const analyze = vi.fn(async ({ items }) => {
      expect(items[0]).toMatchObject({ title: 'Planning', ownerAttribution: 'user' });
      expect(JSON.parse(items[0]!.text ?? '{}')).toEqual({ title: 'Planning' });
      return { modelRef: 'test/model', profileCandidates: [], workThreadCandidates: [], sourceStatuses: [] };
    });
    await deriveConnectedSourceUnderstanding({
      config: ConfigSchema.parse({}), agentId: 'main', sourceInstanceId,
      sourceItemIds, sourceRunId, processingPolicy, analyze,
    });
    expect(analyze).toHaveBeenCalledOnce();
  });

  it('keeps current responsibilities in knowledge instead of the durable user model', async () => {
    const { sourceInstanceId, sourceRunId, processingPolicy } = sourceContext('gmail');
    const sourceItemIds = upsertKnowledgeSourceItems([sourceRow(sourceInstanceId, 1, false)]).changedItemIds;
    const result = await deriveConnectedSourceUnderstanding({
      config: ConfigSchema.parse({}), agentId: 'main', sourceInstanceId, sourceItemIds, sourceRunId, processingPolicy,
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
    expect(listKnowledgeItems()).toEqual([expect.objectContaining({
      kind: 'work_thread',
      scope: { type: 'global' },
      content: 'Atlas launch: Review in progress.',
    })]);
    const [extraction] = listContextExtractionRuns({ sourceRef: `understanding-source-run:${sourceRunId}` });
    expect(listContextExtractionOutputs(extraction!.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidateKey: 'connected-profile:responsibility:atlas', outcome: 'rejected' }),
      expect.objectContaining({ objectType: 'knowledge', objectId: listKnowledgeItems()[0]!.id, outcome: 'created' }),
    ]));
  });

  it('creates only repeated owner-backed durable assertions with separate evidence', async () => {
    const { sourceInstanceId, sourceRunId, processingPolicy } = sourceContext('slack');
    const sourceItemIds = upsertKnowledgeSourceItems(
      [1, 2, 3].map((index) => sourceRow(sourceInstanceId, index, true)),
    ).changedItemIds;
    const result = await deriveConnectedSourceUnderstanding({
      config: ConfigSchema.parse({}), agentId: 'main', sourceInstanceId, sourceItemIds, sourceRunId, processingPolicy,
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
    const [extraction] = listContextExtractionRuns({ sourceRef: `understanding-source-run:${sourceRunId}` });
    expect(listContextExtractionOutputs(extraction!.id)).toEqual([
      expect.objectContaining({ objectType: 'assertion', objectId: assertion!.id, outcome: 'created' }),
    ]);
  });

  it('extracts demonstrated capabilities and current goals from owner activity', async () => {
    const { sourceInstanceId, sourceRunId, processingPolicy } = sourceContext('github');
    const sourceItemIds = upsertKnowledgeSourceItems(
      [1, 2].map((index) => {
        const row = sourceRow(sourceInstanceId, index, true);
        return { ...row, metadata: { ...row.metadata, toolkit: 'github' } };
      }),
    ).changedItemIds;
    const result = await deriveConnectedSourceUnderstanding({
      config: ConfigSchema.parse({}), agentId: 'main', sourceInstanceId, sourceItemIds, sourceRunId, processingPolicy,
      analyze: vi.fn(async ({ items }) => ({
        modelRef: 'test/model',
        profileCandidates: [{
          id: 'capability', category: 'capability', factKey: 'typescript-review',
          statement: 'Regularly reviews TypeScript changes.', confidence: 'high', evidence: ['repeated reviews'],
          evidenceRefs: items.map((value) => value.evidenceRef), status: 'pending',
        }],
        workThreadCandidates: [{
          topicKey: 'atlas-launch', title: 'Atlas launch', summary: 'Preparing the release review.',
          horizon: 'current', status: 'active', confidence: 'high',
          evidenceRefs: items.map((value) => value.evidenceRef),
        }],
        sourceStatuses: [{ sourceId: 'connected-work', status: 'completed' }],
      })),
    });
    expect(result).toEqual({ created: 2, knowledgeCount: 1, status: 'completed' });
    expect(listUserAssertions()).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: 'capabilities', kind: 'capability', layer: 'pattern' }),
      expect.objectContaining({ domain: 'goals', kind: 'current_state', layer: 'fact', allowedUses: expect.arrayContaining(['remind']) }),
    ]));
    expect(listUserModelObservations({ domain: 'capabilities' })).toEqual([
      expect.objectContaining({ type: 'authored_code_activity', value: expect.not.objectContaining({ content: expect.anything() }) }),
      expect.objectContaining({ type: 'authored_code_activity', value: expect.not.objectContaining({ content: expect.anything() }) }),
    ]);
  });

  it('rejects sensitive inferences in Chinese even when the model labels them as capability', async () => {
    const { sourceInstanceId, sourceRunId, processingPolicy } = sourceContext('github');
    const sourceItemIds = upsertKnowledgeSourceItems(
      [1, 2].map((index) => sourceRow(sourceInstanceId, index, true)),
    ).changedItemIds;
    const result = await deriveConnectedSourceUnderstanding({
      config: ConfigSchema.parse({}), agentId: 'main', sourceInstanceId, sourceItemIds, sourceRunId, processingPolicy,
      analyze: vi.fn(async ({ items }) => ({
        modelRef: 'test/model', profileCandidates: [{
          id: 'unsafe', category: 'capability', factKey: 'payroll', statement: '经常处理员工工资和银行账户。',
          confidence: 'high', evidence: ['repeated'], evidenceRefs: items.map((value) => value.evidenceRef), status: 'pending',
        }], workThreadCandidates: [], sourceStatuses: [{ sourceId: 'connected-work', status: 'completed' }],
      })),
    });
    expect(result).toEqual({ created: 0, knowledgeCount: 0, status: 'completed' });
    expect(listUserAssertions()).toEqual([]);
  });

  it('does not send local-only source content to semantic analysis', async () => {
    const analyze = vi.fn();
    const sourceItemIds = upsertKnowledgeSourceItems([sourceRow('local:notes', 1, true)]).changedItemIds;
    expect(await deriveConnectedSourceUnderstanding({
      config: ConfigSchema.parse({}), agentId: 'main', sourceInstanceId: 'local:notes',
      sourceItemIds, sourceRunId: 'run-local', processingPolicy: 'local_only', analyze,
    })).toEqual({ created: 0, knowledgeCount: 0, status: 'completed' });
    expect(analyze).not.toHaveBeenCalled();
  });

  it('skips semantic analysis when ingestion produced no changes', async () => {
    const analyze = vi.fn();
    const { sourceInstanceId, sourceRunId, processingPolicy } = sourceContext('gmail');
    upsertKnowledgeSourceItems([sourceRow(sourceInstanceId, 1, true)]);

    expect(await deriveConnectedSourceUnderstanding({
      config: ConfigSchema.parse({}), agentId: 'main', sourceInstanceId,
      sourceItemIds: [], sourceRunId, processingPolicy, analyze,
    })).toEqual({ created: 0, knowledgeCount: 0, status: 'completed' });
    expect(analyze).not.toHaveBeenCalled();
  });

  it('uses evidence identity to update a work thread when model wording changes', async () => {
    const { sourceInstanceId, sourceRunId, processingPolicy, grantId } = sourceContext('gmail');
    const firstIds = upsertKnowledgeSourceItems([sourceRow(sourceInstanceId, 1, false)]).changedItemIds;
    const analysis = (title: string, topicKey: string) => vi.fn(async (
      { items }: { items: ReturnType<typeof connectedItemsForUnderstanding> },
    ) => ({
      modelRef: 'test/model', profileCandidates: [],
      workThreadCandidates: [{ topicKey, title, summary: 'Review in progress.', horizon: 'current' as const,
        status: 'active' as const, confidence: 'high' as const, evidenceRefs: [items[0]!.evidenceRef] }],
      sourceStatuses: [{ sourceId: 'connected-work', status: 'completed' as const }],
    }));
    await deriveConnectedSourceUnderstanding({
      config: ConfigSchema.parse({}), agentId: 'main', sourceInstanceId,
      sourceItemIds: firstIds, sourceRunId, processingPolicy, analyze: analysis('Atlas launch', 'atlas'),
    });
    const [first] = listKnowledgeItems();

    const changedIds = upsertKnowledgeSourceItems([{
      ...sourceRow(sourceInstanceId, 1, false),
      contentHash: 'changed-hash',
      normalizedText: JSON.stringify({ title: 'Renamed launch review' }),
    }]).changedItemIds;
    const nextRun = createUnderstandingSourceRun({ grantId, kind: 'incremental' });
    await deriveConnectedSourceUnderstanding({
      config: ConfigSchema.parse({}), agentId: 'main', sourceInstanceId,
      sourceItemIds: changedIds, sourceRunId: nextRun.id, processingPolicy,
      analyze: analysis('Renamed launch review', 'different-model-key'),
    });

    expect(listKnowledgeItems()).toEqual([expect.objectContaining({
      id: first!.id,
      canonicalKey: first!.canonicalKey,
      content: 'Renamed launch review: Review in progress.',
    })]);
  });
});

function sourceContext(kind: string, allowedFields = ['title', 'content', 'timestamps', 'owner_activity', 'status']) {
  const sourceInstanceId = `composio:${kind}:account-1`;
  const grant = upsertUnderstandingSourceGrant({
    sourceKey: `connector-account:${kind}`, adapterId: `connector:${kind}`, category: 'files',
    platform: 'all', displayName: kind, accessMode: 'continuous', retentionPolicy: 'bounded_raw',
    processingPolicy: 'remote_allowed', config: { sourceInstanceId },
  });
  const run = createUnderstandingSourceRun({ grantId: grant.id, kind: 'bootstrap' });
  grantUnderstandingConsent({
    grantId: grant.id, purposes: ['personalization', 'work_assistance'],
    allowedDomains: ['identity', 'goals', 'capabilities', 'preferences', 'behavior'], deniedDomains: ['health'],
    allowedFields, accessMode: 'continuous', lookbackDays: 90,
    rawRetentionDays: 7, processingPolicy: 'remote_allowed', allowedAgentIds: ['main'],
    disclosureVersion: 'test-v1',
  });
  return { sourceInstanceId, sourceRunId: run.id, grantId: grant.id, processingPolicy: grant.processingPolicy };
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
