import { describe, expect, it } from 'vitest';

import { buildFts5SearchQuery, fts5RankToScore } from '../fts.js';

describe('FTS5 search helpers', () => {
  it('builds a safe disjunctive query from natural-language terms', () => {
    expect(buildFts5SearchQuery('  phoenix launch checklist  ')).toBe(
      '"phoenix" OR "launch" OR "checklist"',
    );
    expect(buildFts5SearchQuery('phoenix "launch"')).toBe('"phoenix" OR "launch"');
  });

  it('keeps better (more negative) BM25 ranks above weaker matches', () => {
    expect(fts5RankToScore(-4, -4, -1)).toBeGreaterThan(fts5RankToScore(-1, -4, -1));
    expect(fts5RankToScore(-2, -2, -2)).toBeGreaterThan(0.5);
  });
});
