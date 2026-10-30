/** Opt-in AB/BA real-app acceptance; uses one unchanged host coordinator. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { baseline: { type: 'string' }, candidate: { type: 'string' }, pairs: { type: 'string', default: '3' }, lifecycle: { type: 'string', default: 'fresh' } } });
for (const sha of [values.baseline, values.candidate]) assert.match(sha ?? '', /^[a-f0-9]{64}$/);
assert.notEqual(values.baseline, values.candidate);
assert.ok(['fresh', 'resident', 'both'].includes(values.lifecycle!));
const lifecycles = values.lifecycle === 'both' ? ['fresh', 'resident'] : [values.lifecycle!];
const pairs = Number(values.pairs); assert.ok(Number.isInteger(pairs) && pairs > 0 && pairs <= 5);
const repo = resolve(import.meta.dirname, '..');
const directory = join(repo, '.cache/computer-calculator-live', `alternating-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(directory, { recursive: true });
const hostFiles = ['electron/computer/cua-driver.ts', 'electron/computer/native-windows.ts', 'electron/computer/native-process-identity.ts', 'electron/computer/native-batch.ts', 'electron/computer/window-readiness.ts', 'scripts/verify-computer-calculator-native.mts'];
const hostDigest = () => Object.fromEntries(hostFiles.map(path => [path, createHash('sha256').update(readFileSync(join(repo, path))).digest('hex')]));
const cpuSnapshot = () => cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
const report: any = { createdAt: new Date().toISOString(), baseline: values.baseline, candidate: values.candidate,
  order: 'AB/BA pairs, alternating order across pairs; three process-cold and cross-Space samples per artifact by default',
  hostFiles: hostDigest(), scope: 'Private driver startup through independent result observation; excludes fixture, Electron bootstrap, LLM, gateway, approval, upload and teardown',
  cpuScope: 'CPU busy fraction covers fixture + measured flow + teardown, not just timed execution; other host work is uncontrolled', runs: [] };
try {
  for (let pair = 0; pair < pairs; pair++) for (const lifecycle of lifecycles) for (const scenario of ['cold', 'cross-space']) {
    for (const label of pair % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline']) {
      assert.deepEqual(hostDigest(), report.hostFiles, 'Host coordinator changed during comparison');
      const sha = label === 'baseline' ? values.baseline! : values.candidate!;
      const cpuBefore = cpuSnapshot(); const loadBefore = loadavg();
      const child = spawnSync('pnpm', ['exec', 'tsx', 'scripts/benchmark-computer-calculator-live.mts'], {
        cwd: repo, env: { ...process.env, XOPC_CALCULATOR_DRIVER_SHA: sha, XOPC_CALCULATOR_SCENARIO: scenario, XOPC_CALCULATOR_SAMPLES: '1', XOPC_CALCULATOR_DRIVER_LIFECYCLE: lifecycle },
        encoding: 'utf8', timeout: 150_000, maxBuffer: 20 * 1024 * 1024,
      });
      const cpuAfter = cpuSnapshot(); const stem = `${report.runs.length}-${lifecycle}-${scenario}-${label}`;
      writeFileSync(join(directory, `${stem}.log`), child.stdout + '\n' + child.stderr);
      const offset = child.stdout.lastIndexOf('{\n  "evidence":'); assert.ok(offset >= 0, 'No acceptance report');
      const measured = JSON.parse(child.stdout.slice(offset));
      const totalCpu = cpuAfter.total - cpuBefore.total;
      report.runs.push({ pair, label, scenario, lifecycle, sha, loadBefore, loadAfter: loadavg(),
        cpuBusyFraction: totalCpu > 0 ? 1 - (cpuAfter.idle - cpuBefore.idle) / totalCpu : null, ...measured });
      writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2));
      assert.equal(child.status, 0, 'Acceptance stopped; no input is automatically replayed');
      assert.equal(measured.report.status, 'passed'); assert.equal(measured.report.manifest.sha256, sha);
      assert.deepEqual(hostDigest(), report.hostFiles, 'Host coordinator changed during comparison');
      console.log(JSON.stringify({ directory, pair, label, scenario, totalMs: measured.report.driverStartupPlusExecutionMs,
        stages: measured.report.runs[0].stages, result: measured.report.runs[0].result }));
    }
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1;
} finally {
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ evidence: directory, status: report.status, error: report.error }));
}
