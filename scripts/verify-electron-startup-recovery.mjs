// Launch a separately marked missing-remote-UI fault package; click the native dialog with CUA.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

import { createAcceptanceOutput, localConnectionEnvironment } from './electron-local-connection-support.mjs';
import { installedApplicationPids, killAcceptanceApplication, macPackagedTarget, packagedAcceptanceEnvironment, packagedGatewayEnvironment } from './electron-packaged-acceptance.mjs';

const root = resolve(import.meta.dirname, '..'), index = process.argv.indexOf('--app'); assert(index >= 0);
const target = await macPackagedTarget(process.argv[index + 1]);
const interactionIndex = process.argv.indexOf('--interaction-timeout-ms');
const interactionTimeoutMs = interactionIndex < 0 ? 30_000 : Number(process.argv[interactionIndex + 1]);
assert(Number.isInteger(interactionTimeoutMs) && interactionTimeoutMs >= 1000 && interactionTimeoutMs <= 300_000);
assert(!existsSync(join(target.resources, 'app.asar.unpacked/out/preload/gateway-connections.html')), 'Use a separately marked missing-UI fault package');
const output = await createAcceptanceOutput(join(root, 'reports/s4-native-startup-recovery.json'));
const state = mkdtempSync(join(tmpdir(), 'xopc-s4-recovery-')), config = join(state, 'xopc.json'), token = randomUUID();
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const executablePaths = [...new Set([target.executablePath, realpathSync(target.executablePath)])];
const pids = () => installedApplicationPids(execFileSync('ps', ['-axo', 'pid=,args='], { encoding: 'utf8' }), executablePaths);
const before = new Set(pids());
assert.equal(before.size, 0, 'Stop existing copies of this test artifact before native recovery acceptance');
const report = { passed: false, fault: 'missing remote connection HTML; deliberately modified resource seal, not a release artifact', startedAt: new Date().toISOString(), interactionTimeoutMs, recoveryBudgetMs: 30_000, checks: {} };
let app, logs = '';
try {
  writeFileSync(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port, auth: { mode: 'token', token } }, browser: { enabled: false },
    voice: { languageMode: 'manual', language: 'zh', realtime: { enabled: false, maxDictationMs: 450000 } },
    tools: { media: { audio: { enabled: false, provider: 'openai', fallback: { enabled: false, order: [] },
      providers: { alibaba: { model: 'qwen-audio-3.1-asr-flash' }, openai: { model: 'gpt-4o-mini-transcribe' } } } } },
  }), { mode: 0o600 });
  const env = packagedAcceptanceEnvironment(localConnectionEnvironment(process.env, root, state, config, join(state, 'workspace')));
  env.XOPC_ELECTRON_DEBUG_LIFECYCLE = '1';
  // Seed an existing canonical config through the shipped CLI, without starting a Gateway.
  // First-launch default expansion is normal local behavior, not a recovery-side mutation.
  const fixtureState = mkdtempSync(join(tmpdir(), 'xopc-s4-existing-config-'));
  try {
    const fixtureConfig = join(fixtureState, 'xopc.json'); writeFileSync(fixtureConfig, readFileSync(config), { mode: 0o600 });
    const fixtureEnv = packagedAcceptanceEnvironment(localConnectionEnvironment(process.env, root, fixtureState, fixtureConfig, join(fixtureState, 'workspace')));
    execFileSync(target.executablePath, [target.server, 'config', 'set', 'gateway.port', String(port)], {
      cwd: fixtureState, env: packagedGatewayEnvironment(fixtureEnv, target), stdio: ['ignore', 'pipe', 'pipe'],
    });
    const canonical = readFileSync(fixtureConfig); assert(!canonical.includes(Buffer.from(fixtureState)), 'Fixture must not retain temporary absolute paths');
    writeFileSync(config, canonical, { mode: 0o600 });
  } finally { rmSync(fixtureState, { recursive: true, force: true }); }
  const configBefore = readFileSync(config);
  writeFileSync(join(state, 'config-before.json'), configBefore, { mode: 0o600 });
  report.checks.existingConfigPreparedWithoutGateway = !existsSync(join(state, 'xopc.db')) && !existsSync(join(state, 'workspace'));
  assert(report.checks.existingConfigPreparedWithoutGateway);
  const child = spawn(target.executablePath, ['--gateway-connections'], { cwd: state, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let localChoiceAt;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    logs = (logs + chunk).slice(-8000);
    if (localChoiceAt === undefined && logs.includes('[GatewayConnections] Startup recovery choice: local')) localChoiceAt = performance.now();
  });
  app = { process: () => child, close: async () => { if (child.exitCode === null && child.signalCode === null) killAcceptanceApplication(app); } };
  child.once('exit', (code, signal) => { report.originalProcessExit = { code, signal }; });
  const startupDeadline = Date.now() + 30_000;
  while (!logs.includes('Preview startup failed') && Date.now() < startupDeadline) await delay(100);
  assert(logs.includes('Preview startup failed'), 'Missing-UI startup did not reach independent recovery');
  report.runtime = { executable: target.executablePath, fuses: target.fuses, pid: child.pid, nativeUiOnly: true };
  assert(!existsSync(join(state, 'xopc.db')) && !existsSync(join(state, 'workspace')));
  report.checks.noLocalInitializationBeforeUserChoice = true;
  console.log('Native recovery dialog ready for CUA: choose 使用本地模式');
  // Operator/tool waiting is separate from the unchanged post-choice startup budget.
  const choiceDeadline = performance.now() + interactionTimeoutMs;
  while (localChoiceAt === undefined && performance.now() < choiceDeadline && !logs.includes('Startup recovery choice: exit')) await delay(100);
  assert(localChoiceAt !== undefined, 'Native local recovery choice was not observed within the interaction window');
  report.checks.explicitLocalChoiceObserved = true;
  const deadline = localChoiceAt + 30_000;
  report.observedRelaunchPids = [];
  let ready = false;
  while (performance.now() < deadline) {
    for (const pid of pids()) if (pid !== child.pid && !report.observedRelaunchPids.includes(pid)) report.observedRelaunchPids.push(pid);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/config`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) });
      const log = join(state, 'electron/electron-startup.log');
      const lifecycle = existsSync(log) ? readFileSync(log, 'utf8') : '';
      if (r.ok && lifecycle.includes(`preload ready url=http://127.0.0.1:${port}/`)
        && lifecycle.split('\n').some(line => line.includes('window did-frame-finish-load') && line.includes(`url=http://127.0.0.1:${port}/`))) { ready = true; break; }
    } catch { /* Wait for explicit native UI choice and the original local window. */ }
    await delay(100);
  }
  assert(ready, 'Native recovery did not relaunch local within 30 seconds');
  report.localChoiceToReadyMs = performance.now() - localChoiceAt;
  report.checks.originalLocalWindowAndPreloadLoaded = true;
  const configAfter = readFileSync(config);
  report.checks.configBytesUnchanged = configBefore.equals(configAfter);
  assert.deepEqual(JSON.parse(configAfter), JSON.parse(configBefore), 'Existing local settings changed');
  assert(report.checks.configBytesUnchanged, 'Existing initialized config was rewritten');
  assert(existsSync(join(state, 'xopc.db')));
  assert.equal(pids().filter(pid => !before.has(pid) && pid !== app.process().pid).length, 1);
  report.checks.explicitNativeChoiceRelaunchesLocal = true; report.checks.localConfigPreserved = true; report.passed = true;
} catch (error) { report.error = String(error?.stack ?? error).replaceAll(token, '[redacted]'); process.exitCode = 1; }
finally {
  report.applicationLogs = logs.replaceAll(token, '[redacted]');
  const startupLog = join(state, 'electron/electron-startup.log');
  if (existsSync(startupLog)) report.localStartupLogs = readFileSync(startupLog, 'utf8').slice(-20000).replaceAll(token, '[redacted]');
  for (const pid of pids().filter(pid => !before.has(pid))) killAcceptanceApplication({ process: () => ({ pid }) });
  await app?.close().catch(() => {});
  if (report.passed) rmSync(state, { recursive: true, force: true });
  else report.failureStateDirectory = state;
  report.finishedAt = new Date().toISOString(); writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
