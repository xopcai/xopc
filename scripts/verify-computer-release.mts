import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { assertComputerReleaseEvidence } from '../src/computer/release-gate.js';

const exec = promisify(execFile);
const [appPath, reportPath] = process.argv.slice(2);
if (!appPath || !reportPath) throw new Error('Usage: node --import tsx scripts/verify-computer-release.mts <xopc.app> <report.json>');
if (process.platform !== 'darwin') throw new Error('Computer Use release certification currently supports macOS only');
const app = resolve(appPath);
const reportFile = resolve(reportPath);
const report = JSON.parse(await readFile(reportFile, 'utf8'));
const summary = assertComputerReleaseEvidence(report);
for (const reference of Object.values(report.evidence) as string[]) {
  await access(isAbsolute(reference) ? reference : resolve(dirname(reportFile), reference));
}
const driver = join(app, 'Contents', 'Resources', 'bin', 'cua-driver');
await access(driver);
await exec('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
await exec('codesign', ['--verify', '--strict', '--verbose=2', driver]);
await exec('spctl', ['--assess', '--verbose=2', '--type', 'execute', app]);
await exec('xcrun', ['stapler', 'validate', app]);
console.log(JSON.stringify({ certified: true, app, passed: summary.passed, expectedRuns: summary.expectedRuns }, null, 2));
