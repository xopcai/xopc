import { describe, expect, it } from 'vitest';

import { CHECKLIST_ITEM_PENDING } from '../checklist-types.js';
import { mergeDecomposedChecklistItems } from '../state.js';

describe('mergeDecomposedChecklistItems', () => {
  it('keeps user rows and appends judge decomposition', () => {
    const t0 = 1;
    const merged = mergeDecomposedChecklistItems(
      [
        {
          text: 'User criterion',
          status: CHECKLIST_ITEM_PENDING,
          addedBy: 'user',
          addedAt: t0,
        },
      ],
      [{ text: 'Judge A' }, { text: 'Judge B' }],
    );
    expect(merged).toHaveLength(3);
    expect(merged[0]!.text).toBe('User criterion');
    expect(merged[0]!.addedBy).toBe('user');
    expect(merged[1]!.text).toBe('Judge A');
    expect(merged[1]!.addedBy).toBe('judge');
    expect(merged[2]!.text).toBe('Judge B');
  });

  it('skips judge lines that duplicate existing text (case-insensitive)', () => {
    const merged = mergeDecomposedChecklistItems(
      [{ text: 'CI green', status: CHECKLIST_ITEM_PENDING, addedBy: 'user', addedAt: 1 }],
      [{ text: 'CI GREEN' }, { text: 'Docs updated' }],
    );
    expect(merged.map((x) => x.text)).toEqual(['CI green', 'Docs updated']);
  });

  it('matches empty prior to pure judge list', () => {
    const merged = mergeDecomposedChecklistItems([], [{ text: 'Only judge' }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.addedBy).toBe('judge');
  });
});
