// Launch a separately marked missing-remote-UI fault package; click the native dialog with CUA.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { createAcceptanceOutput, localConnectionEnvironment } from './electron-local-connection-support.mjs';
import { installedApplicationPids, killAcceptanceApplication, macPackagedTarget, packagedAcceptanceEnvironment } from './electron-packaged-acceptance.mjs';

const root = resolve(import.meta.dirname, '..'), index = process.argv.indexOf('--app'); assert(index >= 0);
const target = await macPackagedTarget(process.argv[index + 1]);
assert(!existsSync(join(target.resources, 'app.asar.unpacked/out/preload/gateway-connections.html')), 'Use a separately marked missing-UI fault package');
const output = await createAcceptanceOutput(join(root, 'reports/s4-native-startup-recovery.json'));
const state = mkdtempSync(join(tmpdir(), 'xopc-s4-recovery-')), config = join(state, 'xopc.json'), token = randomUUID();
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const executablePaths = [...new Set([target.executablePath, realpathSync(target.executablePath)])];
const pids = () => installedApplicationPids(execFileSync('ps', ['-axo', 'pid=,args='], { encoding: 'utf8' }), executablePaths);
const before = new Set(pids());
const report = { passed: false, fault: 'missing remote connection HTML; deliberately modified resource seal, not a release artifact', startedAt: new Date().toISOString(), checks: {} };
let app;
try {
  writeFileSync(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port, auth: { mode: 'token', token } }, browser: { enabled: false } }), { mode: 0o600 });
  const configBefore = readFileSync(config);
  const env = packagedAcceptanceEnvironment(localConnectionEnvironment(process.env, root, state, config, join(state, 'workspace')));
  const child = spawn(target.executablePath, ['--gateway-connections'], { cwd: state, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
  app = { process: () => child, close: async () => { if (child.exitCode === null && child.signalCode === null) killAcceptanceApplication(app); } };
  const startupDeadline = Date.now() + 30_000;
  while (!logs.includes('Preview startup failed') && Date.now() < startupDeadline) await delay(100);
  assert(logs.includes('Preview startup failed'), 'Missing-UI startup did not reach independent recovery');
  report.runtime = { executable: target.executablePath, fuses: target.fuses, pid: child.pid, nativeUiOnly: true };
  assert(!existsSync(join(state, 'xopc.db')) && !existsSync(join(state, 'workspace')));
  report.checks.noLocalInitializationBeforeUserChoice = true;
  console.log('Native recovery dialog ready for CUA: choose 使用本地模式');
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/config`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) }); if (r.ok) { ready = true; break; } } catch { /* Wait for explicit native UI choice. */ }
    await delay(100);
  }
  assert(ready, 'Native recovery did not relaunch local within 30 seconds');
  assert(configBefore.equals(readFileSync(config))); assert(existsSync(join(state, 'xopc.db')));
  assert.equal(pids().filter(pid => !before.has(pid) && pid !== app.process().pid).length, 1);
  report.checks.explicitNativeChoiceRelaunchesLocal = true; report.checks.localConfigPreserved = true; report.passed = true;
} catch (error) { report.error = String(error?.stack ?? error).replaceAll(token, '[redacted]'); process.exitCode = 1; }
finally {
  for (const pid of pids().filter(pid => !before.has(pid))) killAcceptanceApplication({ process: () => ({ pid }) });
  await app?.close().catch(() => {}); report.finishedAt = new Date().toISOString(); writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); rmSync(state, { recursive: true, force: true }); console.log(JSON.stringify(report));
}
