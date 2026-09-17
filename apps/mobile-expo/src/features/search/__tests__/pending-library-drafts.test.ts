import { describe, expect, it } from 'vitest';

import { pendingLibraryDrafts } from '../pending-library-drafts';

describe('pendingLibraryDrafts', () => {
  it('returns matching unsynced notes without a gateway request', () => {
    expect(pendingLibraryDrafts([{ id: '1', kind: 'create_note', payload: { text: 'Offline meeting plan' }, createdAt: 1 }], 'meeting')).toEqual([
      expect.objectContaining({ id: 'draft:1', kind: 'draft' }),
    ]);
  });
});
