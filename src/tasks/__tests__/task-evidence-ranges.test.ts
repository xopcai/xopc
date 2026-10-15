import { describe, expect, it } from 'vitest';

import { observedEvidenceExcerpt, suggestedEvidenceRanges } from '../task-evidence-ranges.js';

describe('Host evidence ranges', () => {
  it('copies original escapes and Unicode without model reconstruction', () => {
    const body = '😀\nassert.equal(value, "month,total\\n2026-01,150\\n");';
    expect(observedEvidenceExcerpt(body, { start: 2, end: Array.from(body).length }))
      .toBe('assert.equal(value, "month,total\\n2026-01,150\\n");');
    expect(suggestedEvidenceRanges(body)).toEqual([{ start: 0, end: Array.from(body).length }]);
  });
  it('rejects negative, empty, fractional, oversized and out-of-read ranges', () => {
    for (const range of [{ start: -1, end: 2 }, { start: 0, end: 0 }, { start: 0.1, end: 2 },
      { start: 0, end: 1001 }, { start: 2001, end: 2002 }]) {
      expect(() => observedEvidenceExcerpt('a'.repeat(2001), range)).toThrow(/Evidence range/);
    }
  });
});
