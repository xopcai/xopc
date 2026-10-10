import { describe, expect, it } from 'vitest';

import { classifyInfrastructureFailure, compareStrategies, gradeAnswer, percentile, summarize, type Sample } from '../codemode-evaluation/metrics.js';
import type { EvalCase } from '../codemode-evaluation/fixtures.js';

const test: EvalCase = { id: 'source-check', category: 'files', prompt: 'Read two files', answer: 42,
  sources: ['a.md', 'b.md'], status: 'ok' };

describe('Codemode evaluation grading', () => {
  it('rejects fabricated citations even when the numeric answer is correct', () => {
    const response = JSON.stringify({ answer: 42, sources: ['a.md', 'b.md'], status: 'ok' });
    expect(gradeAnswer(test, response, new Set(['a.md']))).toEqual({ passed: false, sourcesComplete: false });
    expect(gradeAnswer(test, response, new Set(test.sources))).toEqual({ passed: true, sourcesComplete: true });
    expect(gradeAnswer(test, JSON.stringify({ answer: 43, sources: test.sources, status: 'ok' }), new Set(test.sources)).passed).toBe(false);
  });
  it('keeps missing and denied tasks in scoring instead of discarding them', () => {
    const denied = { ...test, answer: null, sources: [], status: 'denied' as const };
    expect(gradeAnswer(denied, '{"answer":null,"sources":[],"status":"denied"}', new Set()).passed).toBe(true);
    expect(gradeAnswer(denied, '{"answer":null,"sources":[],"status":"ok"}', new Set()).passed).toBe(false);
    const rows = [{ mode: 'direct', passed: true, sourcesComplete: true, elapsedMs: 10 },
      { mode: 'direct', passed: false, sourcesComplete: false, elapsedMs: 90 }] as Sample[];
    expect(summarize(rows).byMode.direct).toMatchObject({ samples: 2, passed: 1, successRate: 0.5, p95Ms: 90 });
  });
  it('uses the nearest-rank tail including slow failures', () => {
    expect(percentile([100, 5, 10, 20], 0.95)).toBe(100);
  });
  it('invalidates a full comparison when fast provider refusals look like a latency improvement', () => {
    const rows = Array.from({ length: 30 }, (_, task) => Array.from({ length: 3 }, (_, repeat) =>
      (['direct', 'batch', 'codemode'] as const).map(mode => ({
        key: `${task}/${repeat}/${mode}`, caseId: `files-${task}`, category: 'files', repeat, mode,
        elapsedMs: mode === 'codemode' ? 1 : 100, input: mode === 'codemode' ? 1 : 100,
        cacheRead: 0, cacheWrite: 0, passed: true, forbiddenAccesses: 0, stateLeaks: 0,
      } as Sample)))).flat(2);
    expect(compareStrategies(rows).modelEvaluationGatePassed).toBe(true);
    rows[2].error = '429 {"error":{"type":"rate_limit_error"}}';
    expect(compareStrategies(rows)).toMatchObject({ sampleGate: true, infrastructureFailures: 1,
      validComparison: false, modelEvaluationGatePassed: false });
    expect(classifyInfrastructureFailure('402 Insufficient Balance')).toBe('balance');
    expect(classifyInfrastructureFailure('400: invalid_request_error')).toBe('protocol');
    expect(classifyInfrastructureFailure('Maximum tool failures reached')).toBeUndefined();
  });
});
