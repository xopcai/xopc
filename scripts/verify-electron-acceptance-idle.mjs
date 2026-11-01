// Read-only preflight: never silently stop a user's app or accept a busy test environment.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { installedBundleProcesses } from './electron-packaged-acceptance.mjs';
import { createAcceptanceOutput } from './electron-local-connection-support.mjs';

assert.equal(process.platform, 'darwin', 'This installed-app preflight requires macOS');
const paths = [];
for (let index = 2; index < process.argv.length; index++) {
  if (process.argv[index] !== '--app') continue;
  const path = resolve(process.argv[++index]);
  assert(path.endsWith('.app'), 'Expected an explicit test .app path');
  paths.push(path, await realpath(path));
}
assert(paths.length, 'Provide test artifacts with --app; do not target user applications');
const output = await createAcceptanceOutput('reports/electron-acceptance-idle.json');
const report = { passed: false, scope: 'Only explicitly named installed test bundles; unrelated host load is not covered', startedAt: new Date().toISOString(), applications: [...new Set(paths)], remaining: [] };
try {
  const deadline = performance.now() + 5000;
  do {
    report.remaining = installedBundleProcesses(execFileSync('ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' }), report.applications);
    if (!report.remaining.length) break;
    await delay(100);
  } while (performance.now() < deadline);
  assert.equal(report.remaining.length, 0, 'Stale test processes would contaminate acceptance; inspect evidence and clean only owned test instances');
  report.passed = true;
} catch (error) { report.error = String(error?.stack ?? error); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report)); }
