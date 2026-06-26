import { describe, expect, it } from 'vitest';

import { shouldRunInitialChecklistDecomposition } from '../post-turn.js';

describe('shouldRunInitialChecklistDecomposition', () => {
  it('decomposes when the checklist is empty', () => {
    expect(
      shouldRunInitialChecklistDecomposition({
        checklistLength: 0,
        turnsUsed: 3,
        checklistDecomposePolicy: 'empty_only',
      }),
    ).toBe(true);
  });

  it('preserves legacy behavior for existing user criteria', () => {
    expect(
      shouldRunInitialChecklistDecomposition({
        checklistLength: 2,
        turnsUsed: 0,
        checklistDecomposePolicy: 'empty_only',
      }),
    ).toBe(false);
  });

  it('supplements existing criteria only on the first turn', () => {
    expect(
      shouldRunInitialChecklistDecomposition({
        checklistLength: 2,
        turnsUsed: 0,
        checklistDecomposePolicy: 'supplement_existing',
      }),
    ).toBe(true);
    expect(
      shouldRunInitialChecklistDecomposition({
        checklistLength: 2,
        turnsUsed: 1,
        checklistDecomposePolicy: 'supplement_existing',
      }),
    ).toBe(false);
  });
});
