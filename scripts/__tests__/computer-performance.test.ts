import { expect, it } from 'vitest';
import { summarizeComputerTimings } from '../lib/computer-performance.mjs';
it('reports sample counts, failures and nearest-rank percentiles without hiding outliers', () => {
  const report = summarizeComputerTimings([1, 2, 3, 4, 1000].map(ms => ({ phase: 'observe', ms, ok: ms !== 1000 })));
  expect(report.observe).toEqual({ samples: 5, failed: 1, totalMs: 1010, p50Ms: 3, p95Ms: 1000, minMs: 1, maxMs: 1000 });
});
it('rejects invalid measurements and preserves empty reports', () => {
  expect(summarizeComputerTimings([])).toEqual({});
  for (const ms of [-1, NaN, Infinity]) expect(() => summarizeComputerTimings([{ phase: 'observe', ms, ok: true }])).toThrow();
});
