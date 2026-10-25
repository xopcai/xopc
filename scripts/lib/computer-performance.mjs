/** Nearest-rank percentiles describe these samples only, not a production latency SLA. */
export function summarizeComputerTimings(samples) {
  const phases = {};
  for (const sample of samples) {
    if (!Number.isFinite(sample.ms) || sample.ms < 0 || typeof sample.phase !== 'string') throw new Error('Invalid computer timing sample');
    (phases[sample.phase] ??= []).push(sample);
  }
  return Object.fromEntries(Object.entries(phases).map(([phase, entries]) => {
    const sorted = entries.map(entry => entry.ms).sort((a, b) => a - b);
    const percentile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
    return [phase, { samples: sorted.length, failed: entries.filter(entry => !entry.ok).length,
      totalMs: sorted.reduce((sum, ms) => sum + ms, 0), p50Ms: percentile(0.5), p95Ms: percentile(0.95), minMs: sorted[0], maxMs: sorted.at(-1) }];
  }));
}
