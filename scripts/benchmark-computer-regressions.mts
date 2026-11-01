/** Export existing fault regressions as one reproducible fixture-evidence run. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { output: { type: 'string' } } });
const repo = resolve(import.meta.dirname, '..');
const output = resolve(values.output ?? join(repo, '.cache/computer-benchmark-regressions', randomUUID()));
await mkdir(dirname(output), { recursive: true }); await mkdir(output);
const resultPath = join(output, 'vitest.json');
await writeFile(join(output, 'manifest.json'), JSON.stringify({ version: '1.0.0', startedAt: new Date().toISOString(),
  evidence: 'fixture', modelRequests: 0, scope: 'Existing deterministic observation, input, planning, lifecycle and evaluator regressions. Test durations are not native performance measurements.' }, null, 2));
const vitest = join(dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');
const child = spawn(process.execPath, [vitest, 'run', '--project=unit', '--project=computer-desktop', '--project=scripts',
  'src/computer', 'electron/computer', 'scripts/__tests__/computer-windows-benchmark.test.ts',
  '--reporter=default', '--reporter=json', `--outputFile.json=${resultPath}`],
{ cwd: repo, env: { ...process.env, XOPC_LOG_LEVEL: 'fatal' }, stdio: 'inherit', windowsHide: true });
const abort = () => child.kill(); process.once('SIGINT', abort); process.once('SIGTERM', abort);
try {
  const exit = await new Promise<number | null>((done, reject) => { child.once('error', reject); child.once('exit', done); });
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  await writeFile(join(output, 'summary.json'), JSON.stringify({ evidence: 'fixture', modelRequests: 0,
    passed: result.numPassedTests, failed: result.numFailedTests, pending: result.numPendingTests, success: result.success,
    suites: result.testResults.map((suite: any) => ({ file: suite.name.slice(repo.length + 1), status: suite.status,
      failures: suite.assertionResults.filter((test: any) => test.status === 'failed').map((test: any) => test.fullName) })),
    releaseCertified: false }, null, 2));
  process.exitCode = exit ?? 1;
  console.log(`Computer regression evidence: ${output}`);
} finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
