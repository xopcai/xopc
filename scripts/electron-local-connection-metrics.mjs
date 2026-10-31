import assert from 'node:assert/strict';

export const LEGACY_SAMPLE_PLAN = 'first-launch-heavy-v1';

export function latencySummary(values) {
  if (!values.length) return null;
  assert(values.every(value => Number.isFinite(value) && value >= 0), 'Invalid timing sample');
  const sorted = values.toSorted((a, b) => a - b);
  return { count: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted.at(-1) };
}

/** Retain the frozen mixed P95, and expose its two populations separately. */
export function latencyPopulations(samples, metric) {
  return {
    firstMeasuredPerLaunch: latencySummary(samples.map(sample => sample[metric][0])),
    subsequentInFirstLaunch: latencySummary(samples.flatMap(sample => sample[metric].slice(1))),
  };
}

export function validateSampling(report) {
  assert(report.schemaVersion === 1 || report.schemaVersion === 2, 'Unknown report schema');
  assert((report.samplingPlan ?? LEGACY_SAMPLE_PLAN) === LEGACY_SAMPLE_PLAN, 'Incompatible sampling plan');
  assert(!report.diagnostics && !report.serverDiagnostics, 'Diagnostic runs are not acceptance evidence');
  assert(Number.isInteger(report.runs) && report.runs > 0 && Number.isInteger(report.operations) && report.operations > 0);
  const modes = report.modes ?? ['spawn', 'reuse'];
  assert(modes.length && new Set(modes).size === modes.length && modes.every(mode => ['spawn', 'reuse'].includes(mode)));
  assert.equal(report.samples.length, modes.length * report.runs, 'Incomplete launch samples');
  for (const mode of modes) {
    for (let index = 0; index < report.runs; index++) {
      const matches = report.samples.filter(sample => sample.mode === mode && sample.index === index);
      assert(matches.length === 1 && matches[0].passed, 'Missing, duplicate or failed launch');
      const sample = matches[0];
      for (const metric of ['configMs', 'sessionsMs']) {
        assert.equal(sample[metric].length, index === 0 ? report.operations : 1, 'API sample count changed');
        latencySummary(sample[metric]);
      }
    }
    for (const metric of ['configMs', 'sessionsMs']) {
      assert.deepEqual(report.summary[mode][metric], latencySummary(report.samples.filter(s => s.mode === mode).flatMap(s => s[metric])),
        'Summary does not match retained raw timings');
    }
  }
  return modes;
}

export function assertComparableSampling(baseline, candidate) {
  assert(baseline.passed, 'Comparison baseline did not pass');
  assert.deepEqual(validateSampling(candidate), validateSampling(baseline), 'Mode selection changed');
  assert.equal(candidate.runs, baseline.runs);
  assert.equal(candidate.operations, baseline.operations);
  assert.equal(Boolean(candidate.functional), Boolean(baseline.functional));
}
