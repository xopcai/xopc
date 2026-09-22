import { describe, expect, it } from 'vitest';

import type { CompactionHandover } from '../../../session/compaction-types.js';
import type { TranscriptSourceEntry } from '../../../storage/sqlite/transcript-repository.js';
import { applyCompactionHandoverDelta, handoverForPrompt } from '../compaction-ledger.js';

const current: CompactionHandover = {
  version: 1,
  sourceThroughSeq: 10,
  items: [{
    id: 'existing-item',
    kind: 'current_state',
    text: 'Work is underway.',
    status: 'active',
    sources: [{ entryId: 'entry-1', seq: 1 }],
    identifiers: [],
  }],
};

const source: TranscriptSourceEntry = {
  entryId: 'entry-14',
  seq: 14,
  createdAt: 14,
  row: { role: 'user', content: 'Work completed.' },
};

describe('compaction ledger deltas', () => {
  it('updates an existing persisted item and accepts its already-verified source', () => {
    const result = applyCompactionHandoverDelta({
      text: JSON.stringify({ upserts: [{
        id: 'existing-item',
        kind: 'current_state',
        text: 'Work is complete.',
        status: 'completed',
        sourceSeqs: [1, 14],
        identifiers: [],
      }] }),
      sourceThroughSeq: 14,
      allowedSources: [source],
      current,
    });

    expect(result.items).toEqual([expect.objectContaining({
      id: 'existing-item',
      text: 'Work is complete.',
      sources: [{ entryId: 'entry-1', seq: 1 }, { entryId: 'entry-14', seq: 14 }],
    })]);
    expect(handoverForPrompt(result)).toMatchObject({ items: [{ id: 'existing-item' }] });
  });

  it('removes items only through an explicit superseded update', () => {
    const result = applyCompactionHandoverDelta({
      text: JSON.stringify({ upserts: [{
        id: 'existing-item',
        kind: 'current_state',
        text: 'Work is underway.',
        status: 'superseded',
        sourceSeqs: [1],
        identifiers: [],
      }] }),
      sourceThroughSeq: 14,
      allowedSources: [source],
      current,
    });

    expect(result.items).toEqual([]);
  });

  it('rejects invented item ids and unbounded facts', () => {
    const input = (id: string, text: string) => JSON.stringify({ upserts: [{
      id,
      kind: 'current_state',
      text,
      status: 'active',
      sourceSeqs: [14],
      identifiers: [],
    }] });
    expect(() => applyCompactionHandoverDelta({
      text: input('invented', 'Fact'), sourceThroughSeq: 14, allowedSources: [source], current,
    })).toThrow('unknown item');
    expect(() => applyCompactionHandoverDelta({
      text: input('existing-item', 'x'.repeat(2_001)), sourceThroughSeq: 14, allowedSources: [source], current,
    })).toThrow();
  });
});
