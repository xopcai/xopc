import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { cases } from './cases.mjs';

type Assertion = { fullName: string; status: string };
type TestReport = { testResults: Array<{ name: string; assertionResults: Assertion[] }> };

const repo = fileURLToPath(new URL('../..', import.meta.url));
const { values } = parseArgs({ options: {
  out: { type: 'string', default: '.xopc-evals/task-capability-baseline' },
} });
const output = resolve(repo, values.out);
mkdirSync(output, { recursive: true });
const files = [...new Set(cases.flatMap(test => Object.keys(test.checks)))];
const testReportPath = resolve(output, 'vitest.json');
rmSync(testReportPath, { force: true });
const run = spawnSync('pnpm', [
  'exec', 'vitest', 'run', '--reporter=json', `--outputFile=${testReportPath}`, ...files,
], { cwd: repo, stdio: 'inherit', env: { ...process.env, XOPC_LOG_LEVEL: 'fatal' } });
if (run.error) throw run.error;
if (run.status === null) throw new Error(`Vitest did not exit normally: ${run.signal}`);

const report = JSON.parse(readFileSync(testReportPath, 'utf8')) as TestReport;
const byFile = new Map(report.testResults.map(file => [file.name, file.assertionResults]));
const results = cases.map(({ checks, ...test }) => {
  const evidence = Object.entries(checks).flatMap(([file, expectedNames]) => expectedNames.map(name => {
    const matches = (byFile.get(resolve(repo, file)) ?? []).filter(test => test.fullName.includes(name));
    const status = matches.length === 0 ? 'missing' : matches.every(test => test.status === 'passed') ? 'passed' : 'failed';
    return { file, name, status, assertions: matches };
  }));
  const componentStatus = evidence.some(check => check.status === 'failed') ? 'failed'
    : evidence.some(check => check.status === 'missing') ? 'incomplete' : 'passed';
  return { ...test, componentStatus, endToEnd: 'unverified', evidence };
});

const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
const artifact = resolve(output, 'component-baseline.json');
writeFileSync(artifact, JSON.stringify({
  baseline: 'A', mode: 'component-and-integration', commit,
  generatedAt: new Date().toISOString(), vitestExitCode: run.status, results,
}, null, 2) + '\n');
for (const result of results) {
  console.log(`${result.id} ${result.componentStatus} (${result.evidence.length} checks)`);
  for (const check of result.evidence.filter(check => check.status !== 'passed')) {
    console.log(`  ${check.status}: ${check.file} / ${check.name}`);
  }
}
console.log(artifact);
process.exitCode = run.status || Number(results.some(result => result.componentStatus !== 'passed'));
