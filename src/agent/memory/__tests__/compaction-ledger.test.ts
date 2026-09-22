import { describe, expect, it } from 'vitest';

import type { CompactionHandover } from '../../../session/compaction-types.js';
import type { TranscriptSourceEntry } from '../../../storage/sqlite/transcript-repository.js';
import {
  applyCompactionHandoverDelta,
  consolidateCompactionHandover,
  handoverForPrompt,
  MAX_HANDOVER_ITEMS,
} from '../compaction-ledger.js';

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

function handoverItem(index: number, overrides: Partial<CompactionHandover['items'][number]> = {}) {
  return {
    id: `item-${index}`,
    kind: 'tool_outcome' as const,
    text: `Tool outcome ${index}`,
    status: 'active' as const,
    sources: [{ entryId: `entry-${index}`, seq: index }],
    identifiers: [],
    ...overrides,
  };
}

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

  it('uses a source-independent identity and merges repeated citations', () => {
    const first = applyCompactionHandoverDelta({
      text: JSON.stringify({ upserts: [{
        kind: 'current_state',
        text: 'Verification is running.',
        status: 'active',
        sourceSeqs: [14],
        identifiers: ['verify'],
      }] }),
      sourceThroughSeq: 14,
      allowedSources: [source],
    });
    const nextSource = { ...source, entryId: 'entry-15', seq: 15 };
    const second = applyCompactionHandoverDelta({
      text: JSON.stringify({ upserts: [{
        kind: 'current_state',
        text: 'Verification is running.',
        status: 'active',
        sourceSeqs: [15],
        identifiers: ['verify'],
      }] }),
      sourceThroughSeq: 15,
      allowedSources: [nextSource],
      current: first,
    });

    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({
      id: first.items[0]!.id,
      sources: [{ seq: 14 }, { seq: 15 }],
    });
  });

  it('normalizes harmless formatting without conflating case-sensitive facts', () => {
    const bounded = consolidateCompactionHandover({
      version: 1,
      sourceThroughSeq: 3,
      items: [
        handoverItem(1, { text: 'Update Foo.' }),
        handoverItem(2, { text: 'Update   Foo' }),
        handoverItem(3, { text: 'Update foo' }),
      ],
    });

    expect(bounded.items).toHaveLength(2);
    expect(bounded.items[0]!.sources.map((item) => item.seq)).toEqual([1, 2]);
    expect(bounded.items[1]!.text).toBe('Update foo');
  });

  it('consolidates oversized ledgers while protecting active high-priority facts', () => {
    const currentItems = Array.from({ length: MAX_HANDOVER_ITEMS }, (_, index) => handoverItem(index + 1));
    const result = applyCompactionHandoverDelta({
      text: JSON.stringify({ upserts: [{
        kind: 'pending_user_ask',
        text: 'Ship the requested fix.',
        status: 'active',
        sourceSeqs: [121],
        identifiers: [],
      }] }),
      sourceThroughSeq: 121,
      allowedSources: [{ ...source, entryId: 'entry-121', seq: 121 }],
      current: { version: 1, sourceThroughSeq: 120, items: currentItems },
    });

    expect(result.items).toHaveLength(MAX_HANDOVER_ITEMS);
    expect(result.items).toContainEqual(expect.objectContaining({
      kind: 'pending_user_ask',
      text: 'Ship the requested fix.',
    }));
    expect(result.items.filter((item) => item.kind === 'tool_outcome')).toHaveLength(MAX_HANDOVER_ITEMS - 1);
  });

  it('garbage-collects stale completed history with per-kind budgets', () => {
    const handover: CompactionHandover = {
      version: 1,
      sourceThroughSeq: 40,
      items: Array.from({ length: 40 }, (_, index) => handoverItem(index + 1, {
        kind: 'file_change',
        status: 'completed',
      })),
    };

    const bounded = consolidateCompactionHandover(handover);

    expect(bounded.items).toHaveLength(28);
    expect(bounded.items.map((item) => item.sources[0]!.seq)).toEqual(
      Array.from({ length: 28 }, (_, index) => index + 13),
    );
  });

  it('bounds citation growth while preserving the original and newest evidence', () => {
    const handover: CompactionHandover = {
      version: 1,
      sourceThroughSeq: 20,
      items: Array.from({ length: 20 }, (_, index) => handoverItem(index + 1, {
        text: 'The same durable outcome.',
      })),
    };

    const bounded = consolidateCompactionHandover(handover);

    expect(bounded.items).toHaveLength(1);
    expect(bounded.items[0]!.sources.map((item) => item.seq)).toEqual([1, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });
});
