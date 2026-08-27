import { describe, expect, it } from 'vitest';

import {
  evaluateQuickUnderstandingCase,
  evaluateWorkUnderstandingCase,
  meetsQuickUnderstandingGate,
} from '../evaluation.js';

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

  it('gates quick understanding on quality, source coverage, evidence, and latency', () => {
    const metrics = evaluateQuickUnderstandingCase({
      expectedThreadKeys: ['atlas', 'platform'],
      inferredThreadKeys: ['atlas', 'platform'],
      evidenceBackedThreadKeys: ['atlas', 'platform'],
      expectedSourceIds: ['files', 'bookmarks', 'github', 'calendar'],
      observedSourceIds: ['files', 'bookmarks', 'github', 'calendar'],
      startedAtMs: 1_000,
      firstCandidateAtMs: 4_000,
      timeBudgetMs: 5_000,
    });

    expect(metrics).toMatchObject({
      precision: 1,
      recall: 1,
      evidenceCoverage: 1,
      sourceCoverage: 1,
      timeToFirstCandidateMs: 3_000,
      withinTimeBudget: true,
    });
    expect(meetsQuickUnderstandingGate(metrics, {
      minPrecision: 0.8,
      minRecall: 0.8,
      minEvidenceCoverage: 1,
      minSourceCoverage: 0.75,
    })).toBe(true);
  });
});
