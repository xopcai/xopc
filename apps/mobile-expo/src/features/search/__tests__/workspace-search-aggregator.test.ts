import { describe, expect, it } from 'vitest';

import { aggregateWorkspaceSearchResults, pendingDraftSearchResults } from '../workspace-search-aggregator';

describe('aggregateWorkspaceSearchResults', () => {
  it('keeps the highest-ranked source record and sorts all content types together', () => {
    expect(aggregateWorkspaceSearchResults([
      [{ id: 'note:1', type: 'note', title: 'Plan', score: 4 }],
      [
        { id: 'note:1', type: 'note', title: 'Plan', score: 8, state: 'pending_sync' },
        { id: 'draft:1', type: 'draft', title: 'Offline thought', score: 6 },
      ],
    ])).toEqual([
      expect.objectContaining({ id: 'note:1', score: 8, state: 'pending_sync' }),
      expect.objectContaining({ id: 'draft:1', score: 6 }),
    ]);
  });

  it('returns matching pending drafts without a gateway request', () => {
    expect(pendingDraftSearchResults([{ id: '1', kind: 'create_note', payload: { text: 'Offline meeting plan' }, createdAt: 1 }], 'meeting')).toEqual([expect.objectContaining({ id: 'draft:1', state: 'pending_sync' })]);
  });
});
