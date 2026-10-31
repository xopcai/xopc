import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

import { assertComparableSampling, latencyPopulations, latencySummary } from '../electron-local-connection-metrics.mjs';

function fixture() {
  const samples = ['spawn', 'reuse'].flatMap(mode => Array.from({ length: 3 }, (_, index) => ({
    mode, index, passed: true, configMs: index === 0 ? [60, ...Array(99).fill(2)] : [60],
    sessionsMs: index === 0 ? Array(100).fill(1) : [1],
  })));
  return { schemaVersion: 1, passed: true, runs: 3, operations: 100, functional: false, samples,
    summary: Object.fromEntries(['spawn', 'reuse'].map(mode => [mode, Object.fromEntries(['configMs', 'sessionsMs'].map(metric => [metric,
      latencySummary(samples.filter(s => s.mode === mode).flatMap(s => s[metric]))]))])) };
}

it('exposes slow first-after-launch requests rather than hiding them in warm samples', () => {
  const report = fixture();
  expect(report.summary.reuse.configMs.p95).toBe(2);
  expect(latencyPopulations(report.samples.filter(s => s.mode === 'reuse'), 'configMs')).toMatchObject({
    firstMeasuredPerLaunch: { count: 3, p95: 60 }, subsequentInFirstLaunch: { count: 99, p95: 2 },
  });
});
it('compares the original raw sampling plan with a matching versioned report', () => {
  const legacy = fixture();
  const current = { ...fixture(), schemaVersion: 2, samplingPlan: 'first-launch-heavy-v1', modes: ['spawn', 'reuse'] };
  expect(() => assertComparableSampling(legacy, current)).not.toThrow();
});
it('rejects changed weights even when --runs and --operations are identical', () => {
  const candidate = fixture();
  candidate.samples[1].configMs = Array(100).fill(1);
  expect(() => assertComparableSampling(fixture(), candidate)).toThrow('API sample count changed');
});
it('rejects invalid, incomplete, stale-summary and diagnostic reports', () => {
  const candidate = fixture();
  candidate.samples[0].configMs[0] = NaN;
  expect(() => assertComparableSampling(fixture(), candidate)).toThrow('Invalid timing sample');
  const missing = fixture(); missing.samples.pop();
  expect(() => assertComparableSampling(fixture(), missing)).toThrow('Incomplete');
  const stale = fixture(); stale.summary.reuse.configMs.p95 = 100;
  expect(() => assertComparableSampling(fixture(), stale)).toThrow('Summary');
  expect(() => assertComparableSampling(fixture(), { ...fixture(), diagnostics: true })).toThrow('Diagnostic');
  expect(() => assertComparableSampling(fixture(), { ...fixture(), samplingPlan: 'balanced-v2' })).toThrow('Incompatible');
});

it('refuses to overwrite retained evidence before launching Electron', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-retained-evidence-'));
  const output = join(root, 'failed.json');
  try {
    await writeFile(output, 'retained failed evidence');
    await expect(promisify(execFile)(process.execPath,
      [fileURLToPath(new URL('../verify-electron-local-connection.mjs', import.meta.url)), '--output', output]))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Acceptance output exists') });
    expect(await readFile(output, 'utf8')).toBe('retained failed evidence');
  } finally { await rm(root, { recursive: true, force: true }); }
});
