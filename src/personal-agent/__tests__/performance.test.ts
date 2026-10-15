import { describe, expect, it } from 'vitest';

import { assessMainResponseBudget, latencyDistribution, personalPerformanceSnapshot, recordPersonalPerformance } from '../performance.js';

describe('Personal performance acceptance', () => {
  it('uses nearest rank and retains tail outliers', () => {
    expect(latencyDistribution([...Array(94).fill(10), ...Array(5).fill(100), 1000]))
      .toEqual({ count: 100, p50Ms: 10, p95Ms: 100, p99Ms: 100, maxMs: 1000 });
  });
  it('does not accept a p95 conclusion from two pings or hide failed turns', () => {
    expect(assessMainResponseBudget([900, 1000], [901, 1001], 0).verdict).toBe('insufficient_samples');
    expect(assessMainResponseBudget(Array(40).fill(1000), Array(40).fill(1000), 1).verdict).toBe('failed');
  });
  it('enforces the ten percent budget including its boundary', () => {
    expect(assessMainResponseBudget(Array(40).fill(1000), Array(40).fill(1100), 0).verdict).toBe('passed');
    expect(assessMainResponseBudget(Array(40).fill(1000), Array(40).fill(1101), 0).verdict).toBe('failed');
  });
  it('rejects invalid observations and bounds memory independently of traffic', () => {
    expect(() => latencyDistribution([NaN])).toThrow();
    for (let i = 0; i < 4200; i++) recordPersonalPerformance({ phase: 'tool', durationMs: i, status: 'error', toolCallId: `bounded-${i}` });
    const snapshot = personalPerformanceSnapshot();
    expect(snapshot).toHaveLength(4096);
    expect(snapshot.some(row => row.toolCallId === 'bounded-4199')).toBe(true);
    expect(snapshot.some(row => row.toolCallId === 'bounded-0')).toBe(false);
  });
});
