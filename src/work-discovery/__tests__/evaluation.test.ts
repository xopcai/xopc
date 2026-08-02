import { describe, expect, it } from 'vitest';

import { evaluateWorkUnderstandingCase } from '../evaluation.js';

describe('work understanding evaluation', () => {
  it('scores thread precision, recall, and evidence coverage independently', () => {
    expect(evaluateWorkUnderstandingCase({
      expectedThreadKeys: ['current-agent', 'ongoing-product'],
      inferredThreadKeys: ['current-agent', 'unrelated'],
      evidenceBackedThreadKeys: ['current-agent'],
    })).toEqual({
      precision: 0.5,
      recall: 0.5,
      evidenceCoverage: 0.5,
      f1: 0.5,
    });
  });
});
