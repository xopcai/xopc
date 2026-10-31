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
    mode, index, passed: true, readyMs: 100 + index, shutdownMs: 5, resources: { rssMiB: 20 },
    runtime: { node: '24.22.0', electron: '45.0.0' }, configMs: index === 0 ? [60, ...Array(99).fill(2)] : [60],
    sessionsMs: index === 0 ? Array(100).fill(1) : [1],
  })));
  return { schemaVersion: 1, passed: true, runs: 3, operations: 100, functional: false, osRelease: '25.6.0', samples,
    summary: Object.fromEntries(['spawn', 'reuse'].map(mode => [mode, Object.fromEntries(['configMs', 'sessionsMs', 'readyMs', 'shutdownMs', 'rssMiB'].map(metric => [metric,
      latencySummary(samples.filter(s => s.mode === mode).flatMap(s => metric === 'rssMiB' ? s.resources.rssMiB : s[metric]))]))])) };
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

it.each(['readyMs', 'shutdownMs', 'rssMiB'])('rejects a stale %s summary instead of trusting the P95 field', metric => {
  const candidate = fixture(); candidate.summary.reuse[metric].p95 = 0;
  expect(() => assertComparableSampling(fixture(), candidate)).toThrow('Summary');
});
it.each([null, -1, NaN, Infinity])('rejects invalid startup and RSS raw samples (%s)', value => {
  const startup = fixture(); startup.samples[0].readyMs = value;
  expect(() => assertComparableSampling(fixture(), startup)).toThrow('Invalid timing sample');
  const memory = fixture(); memory.samples[0].resources.rssMiB = value;
  expect(() => assertComparableSampling(fixture(), memory)).toThrow('Invalid timing sample');
});
it('rejects OS and embedded-runtime mismatches within and between reports', () => {
  const os = fixture(); os.osRelease = 'different';
  expect(() => assertComparableSampling(fixture(), os)).toThrow('OS release changed');
  const mixed = fixture(); mixed.samples[1].runtime.electron = '46.0.0';
  expect(() => assertComparableSampling(fixture(), mixed)).toThrow('Runtime changed within report');
  const changed = fixture(); changed.samples.forEach(s => { s.runtime.node = '25.0.0'; });
  expect(() => assertComparableSampling(fixture(), changed)).toThrow('Embedded runtime changed');
});
