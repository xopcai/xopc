import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemoryManager } from '../../agent/memory/manager.js';
import { ConfigSchema } from '../../config/schema.js';
import type { KnowledgeSourceItem } from '../../knowledge/types.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  upsertKnowledgeSourceItems,
} from '../../storage/sqlite/index.js';
import {
  createUnderstandingSourceRun,
  listUserFocuses,
  upsertUnderstandingSourceGrant,
} from '../../user-context/sources/repository.js';
import {
  connectedItemsForUnderstanding,
  deriveConnectedSourceUnderstanding,
} from '../connected-source-understanding.js';

function item(overrides: Partial<KnowledgeSourceItem>): KnowledgeSourceItem {
  return {
    id: 'item-1',
    sourceInstanceId: 'composio:gmail:account-1',
    collectionScope: 'messages',
    externalId: 'mail-1',
    itemType: 'email',
    contentHash: 'hash',
    normalizedText: JSON.stringify({ subject: 'Atlas launch', content: 'Prepare the September launch review.' }),
    metadata: { toolkit: 'gmail', agentId: 'main', actorAttributed: false },
    sensitivity: 'personal',
    retentionClass: 'bounded',
    synthesisPipeline: 'connected_knowledge',
    synthesisStatus: 'pending',
    synthesisAttempts: 0,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('connected source understanding input', () => {
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

  it('keeps rich source text and exact evidence references', () => {
    expect(connectedItemsForUnderstanding([item({})])).toEqual([expect.objectContaining({
      sourceId: 'connected-work',
      type: 'mail',
      title: 'Atlas launch',
      text: expect.stringContaining('Prepare the September launch review.'),
      ownerAttribution: 'shared',
      evidenceRef: 'knowledge-source://item-1',
    })]);
  });

  it('prioritizes explicitly read content and preserves user attribution only when proven', () => {
    const values = connectedItemsForUnderstanding([
      item({ id: 'metadata', normalizedText: JSON.stringify({ subject: 'Metadata only' }) }),
      item({
        id: 'content',
        itemType: 'connected_content',
        normalizedText: JSON.stringify({ title: 'Detailed brief', content: 'Full brief body' }),
        metadata: { toolkit: 'googledrive', agentId: 'main', actorAttributed: true },
      }),
    ]);

    expect(values.map((value) => value.id)).toEqual(['content', 'metadata']);
    expect(values[0]?.ownerAttribution).toBe('user');
  });

  it('persists reviewable understandings and focuses with connector provenance', async () => {
    const sourceInstanceId = 'composio:gmail:account-1';
    const grant = upsertUnderstandingSourceGrant({
      sourceKey: 'connector-account:account-1',
      adapterId: 'connector:composio-gmail',
      category: 'mail',
      platform: 'all',
      displayName: 'Gmail',
      accessMode: 'continuous',
      retentionPolicy: 'bounded_raw',
      processingPolicy: 'remote_allowed',
      config: { sourceInstanceId },
    });
    const sourceRun = createUnderstandingSourceRun({
      grantId: grant.id,
      kind: 'bootstrap',
    });
    upsertKnowledgeSourceItems([{
      sourceInstanceId,
      collectionScope: 'messages',
      externalId: 'mail-1',
      itemType: 'email',
      contentHash: 'hash',
      normalizedText: JSON.stringify({ subject: 'Atlas launch', content: 'Prepare the September launch review.' }),
      metadata: { toolkit: 'gmail', agentId: 'main', actorAttributed: false },
      sensitivity: 'personal',
      retentionClass: 'bounded',
      synthesisPipeline: 'connected_knowledge',
      synthesisStatus: 'pending',
    }]);
    const applyUnderstandingCandidates = vi.fn(async () => ({
      proposed: 1, created: 1, deduplicated: 0, rejected: 0, createdRecords: [],
    }));

    const result = await deriveConnectedSourceUnderstanding({
      config: ConfigSchema.parse({}),
      agentId: 'main',
      sourceInstanceId,
      sourceRunId: sourceRun.id,
      processingPolicy: grant.processingPolicy,
      memoryManager: { applyUnderstandingCandidates } as unknown as MemoryManager,
      analyze: vi.fn(async ({ items }) => ({
        modelRef: 'test/model',
        profileCandidates: [{
          id: 'candidate-1', category: 'responsibility', statement: 'Owns the Atlas launch review.',
          confidence: 'high', evidence: ['The source directly assigns the launch review to the user.'],
          evidenceRefs: [items[0]!.evidenceRef], status: 'pending',
        }],
        workThreadCandidates: [{
          topicKey: 'atlas-launch', title: 'Atlas launch', summary: 'A September review is currently being prepared for Atlas.',
          horizon: 'current', status: 'active', confidence: 'high', evidenceRefs: [items[0]!.evidenceRef],
        }],
        sourceStatuses: [{ sourceId: 'connected-work', status: 'completed' }],
      })),
    });

    expect(result).toEqual({ created: 1, focusCount: 1, status: 'completed' });
    expect(applyUnderstandingCandidates).toHaveBeenCalledWith(
      [expect.objectContaining({ kind: 'project_context', content: 'Owns the Atlas launch review.' })],
      expect.objectContaining({ source: { provider: 'connected-sources', sourceInstanceId } }),
    );
    expect(listUserFocuses()).toEqual([expect.objectContaining({
      canonicalKey: 'connected-focus:atlas-launch',
      sourceRunId: sourceRun.id,
    })]);
  });

  it('does not send local-only source content to semantic analysis', async () => {
    const analyze = vi.fn();
    const sourceInstanceId = 'local:notes';
    upsertKnowledgeSourceItems([{
      sourceInstanceId,
      collectionScope: 'notes',
      externalId: 'note-1',
      itemType: 'document',
      contentHash: 'hash-local',
      normalizedText: JSON.stringify({ title: 'Private note', content: 'Never upload this.' }),
      metadata: { agentId: 'main' },
      sensitivity: 'personal',
      retentionClass: 'bounded',
      synthesisPipeline: 'connected_knowledge',
      synthesisStatus: 'pending',
    }]);

    const result = await deriveConnectedSourceUnderstanding({
      config: ConfigSchema.parse({}),
      agentId: 'main',
      sourceInstanceId,
      sourceRunId: 'run-local',
      processingPolicy: 'local_only',
      memoryManager: {} as MemoryManager,
      analyze,
    });

    expect(result).toEqual({ created: 0, focusCount: 0, status: 'completed' });
    expect(analyze).not.toHaveBeenCalled();
  });
});
