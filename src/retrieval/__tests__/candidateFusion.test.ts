import { describe, expect, it } from 'vitest';

import { fuseRankedCandidates } from '../candidateFusion.js';

describe('fuseRankedCandidates', () => {
  it('rewards candidates found by independent channels', () => {
    const scores = fuseRankedCandidates([
      { weight: 1, ids: ['fts-only', 'shared'] },
      { weight: 0.8, ids: ['shared', 'lexical-only'] },
    ]);
    expect(scores.get('shared')).toBeGreaterThan(scores.get('fts-only')!);
    expect(scores.get('shared')).toBeGreaterThan(scores.get('lexical-only')!);
  });

  it('deduplicates repeated ids inside one channel', () => {
    const scores = fuseRankedCandidates([{ weight: 1, ids: ['a', 'a', 'b'] }]);
    expect(scores.get('a')).toBe(1);
    expect(scores.get('b')).toBeLessThan(1);
  });
});
