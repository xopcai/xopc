import { describe, expect, it } from 'vitest';

import type { KnowledgeSourceItem } from '../types.js';
import { deriveConnectedUnderstandingCandidates } from '../connected-understanding-pipeline.js';

function item(id: string, patch: Partial<KnowledgeSourceItem> = {}): KnowledgeSourceItem {
  return {
    id,
    sourceInstanceId: 'composio:composio-gmail:work',
    externalId: id,
    itemType: 'email',
    contentHash: id,
    metadata: {},
    sensitivity: 'personal',
    retentionClass: 'bounded',
    synthesisPipeline: 'connected_knowledge',
    synthesisStatus: 'completed',
    synthesisAttempts: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...patch,
  };
}

describe('connected understanding derivation', () => {
  it('requires repeated evidence and preserves the display identity', () => {
    const candidates = deriveConnectedUnderstandingCandidates([
      item('mail-1', { metadata: { personEntities: [{ name: 'Alice Zhang' }] } }),
      item('mail-2', { metadata: { personEntities: [{ name: 'Alice Zhang' }] } }),
      item('mail-3', { metadata: { personEntities: [{ name: 'One-off Person' }] } }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.candidate).toMatchObject({
      kind: 'relationship',
      content: 'Frequently collaborates with Alice Zhang.',
      explicitness: 'inferred',
    });
    expect(candidates[0]?.sourceItemIds).toEqual(['mail-1', 'mail-2']);
  });

  it('derives a routine only after three matching calendar observations', () => {
    const candidates = deriveConnectedUnderstandingCandidates([
      item('event-1', { itemType: 'calendar_event', occurredAt: '2026-08-03T09:00:00.000Z' }),
      item('event-2', { itemType: 'calendar_event', occurredAt: '2026-08-10T09:30:00.000Z' }),
      item('event-3', { itemType: 'calendar_event', occurredAt: '2026-08-17T09:45:00.000Z' }),
    ]);
    expect(candidates).toContainEqual(expect.objectContaining({
      candidate: expect.objectContaining({ kind: 'routine', content: expect.stringContaining('Monday') }),
      sourceItemIds: ['event-1', 'event-2', 'event-3'],
    }));
  });

  it('turns repeated repository evidence into reviewable project context', () => {
    const candidates = deriveConnectedUnderstandingCandidates([
      item('github-1', { itemType: 'development_activity', normalizedText: JSON.stringify({ repository: { full_name: 'xopc-ai/xopc' } }) }),
      item('linear-1', { itemType: 'work_item', normalizedText: JSON.stringify({ project: 'xopc-ai/xopc' }) }),
    ]);
    expect(candidates).toContainEqual(expect.objectContaining({
      candidate: expect.objectContaining({
        kind: 'project_context',
        content: 'Current connected work frequently involves xopc-ai/xopc.',
        tags: expect.arrayContaining(['user-understanding', 'project-signal']),
      }),
      sourceItemIds: ['github-1', 'linear-1'],
    }));
  });

  it('never derives understanding from secret source items', () => {
    expect(deriveConnectedUnderstandingCandidates([
      item('secret-1', { sensitivity: 'secret', metadata: { personEntities: [{ name: 'Alice' }] } }),
      item('secret-2', { sensitivity: 'secret', metadata: { personEntities: [{ name: 'Alice' }] } }),
    ])).toEqual([]);
  });
});
