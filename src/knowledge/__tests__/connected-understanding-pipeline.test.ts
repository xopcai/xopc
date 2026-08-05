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
      item('mail-1', { occurredAt: '2026-08-01T09:00:00.000Z', metadata: { actorAttributed: true, logicalEventKey: 'gmail:1', personEntities: [{ name: 'Alice Zhang' }] } }),
      item('mail-2', { occurredAt: '2026-08-02T09:00:00.000Z', metadata: { actorAttributed: true, logicalEventKey: 'gmail:2', personEntities: [{ name: 'Alice Zhang' }] } }),
      item('mail-3', { occurredAt: '2026-08-03T09:00:00.000Z', metadata: { actorAttributed: true, logicalEventKey: 'gmail:3', personEntities: [{ name: 'Alice Zhang' }] } }),
      item('mail-3-duplicate', { occurredAt: '2026-08-03T09:00:00.000Z', metadata: { actorAttributed: true, logicalEventKey: 'gmail:3', personEntities: [{ name: 'Alice Zhang' }] } }),
      item('mail-4', { occurredAt: '2026-08-03T10:00:00.000Z', metadata: { actorAttributed: true, logicalEventKey: 'gmail:4', personEntities: [{ name: 'One-off Person' }] } }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.candidate).toMatchObject({
      kind: 'relationship',
      content: 'Frequently collaborates with Alice Zhang.',
      explicitness: 'inferred',
    });
    expect(candidates[0]?.sourceItemIds).toEqual(['mail-1', 'mail-2', 'mail-3']);
  });

  it('derives a routine only after three matching calendar observations', () => {
    const candidates = deriveConnectedUnderstandingCandidates([
      item('event-1', { itemType: 'calendar_event', occurredAt: '2026-07-13T09:00:00.000Z', metadata: { logicalEventKey: 'calendar:1' } }),
      item('event-2', { itemType: 'calendar_event', occurredAt: '2026-07-20T09:30:00.000Z', metadata: { logicalEventKey: 'calendar:2' } }),
      item('event-3', { itemType: 'calendar_event', occurredAt: '2026-07-27T09:45:00.000Z', metadata: { logicalEventKey: 'calendar:3' } }),
    ]);
    expect(candidates).toContainEqual(expect.objectContaining({
      candidate: expect.objectContaining({ kind: 'routine', content: expect.stringContaining('Monday') }),
      sourceItemIds: ['event-1', 'event-2', 'event-3'],
    }));
  });

  it('does not treat repeated repository inventories as user activity', () => {
    const candidates = deriveConnectedUnderstandingCandidates([
      item('github-1', { itemType: 'development_activity', normalizedText: JSON.stringify({ repository: { full_name: 'xopc-ai/xopc' } }) }),
      item('linear-1', { itemType: 'work_item', normalizedText: JSON.stringify({ project: 'xopc-ai/xopc' }) }),
    ]);
    expect(candidates).toEqual([]);
  });

  it('derives project context only from attributed activity across multiple days', () => {
    const activity = (id: string, occurredAt: string, actorAttributed = true) => item(id, {
      itemType: 'development_activity',
      occurredAt,
      metadata: {
        observationKind: 'activity',
        logicalEventKey: `github:${id}`,
        subjectKey: 'xopcai/xopc',
        actorAttributed,
      },
    });
    const candidates = deriveConnectedUnderstandingCandidates([
      activity('commit-1', '2026-08-03T09:00:00.000Z'),
      activity('commit-2', '2026-08-03T10:00:00.000Z'),
      activity('commit-3', '2026-08-04T09:00:00.000Z'),
      activity('someone-else', '2026-08-04T10:00:00.000Z', false),
    ]);

    expect(candidates).toContainEqual(expect.objectContaining({
      candidate: expect.objectContaining({
        kind: 'project_context',
        content: 'Recently contributed repeatedly to xopcai/xopc.',
        tags: expect.arrayContaining(['attributed-project-activity']),
      }),
      sourceItemIds: ['commit-1', 'commit-2', 'commit-3'],
    }));
  });

  it('never derives understanding from secret source items', () => {
    expect(deriveConnectedUnderstandingCandidates([
      item('secret-1', { sensitivity: 'secret', metadata: { personEntities: [{ name: 'Alice' }] } }),
      item('secret-2', { sensitivity: 'secret', metadata: { personEntities: [{ name: 'Alice' }] } }),
    ])).toEqual([]);
  });
});
