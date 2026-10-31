// Isolated production-main acceptance and repeatable local connection baseline.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir, platform, arch, release } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

import { _electron } from 'playwright-core';

import { localConnectionEnvironment, prepareLocalConnectionLayout, withTimeout } from './electron-local-connection-support.mjs';

assert.notEqual(platform(), 'win32', 'This acceptance runner requires POSIX process inspection; Windows acceptance is separate');

const flag = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const runs = Number(flag('--runs', '30'));
const operations = Number(flag('--operations', '100'));
const functional = process.argv.includes('--functional');
const comparePath = flag('--compare', undefined);
assert(Number.isInteger(runs) && runs > 0);
assert(Number.isInteger(operations) && operations > 0);
const output = resolve(flag('--output', 'reports/electron-local-connection.json'));
assert(!comparePath || resolve(comparePath) !== output, 'Do not overwrite the comparison baseline');
const root = resolve(import.meta.dirname, '..');
const artifactRoot = resolve(flag('--artifact-root', root));
const entry = join(artifactRoot, 'out/main/index.js');
const artifactSha256 = createHash('sha256').update(await readFile(entry)).digest('hex');
let cleanupLayout;
const result = {
  schemaVersion: 1, startedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  worktreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  artifactSha256, developmentLayoutLink: true, node: process.version, platform: platform(), arch: arch(), osRelease: release(),
  artifactSourceRef: flag('--artifact-source-ref', 'working-tree'),
  scope: 'Built production Electron main/preload and Gateway; development Electron runtime, not signed installer or real remote server',
  runs, operations, functional, samples: [], passed: false,
};
await mkdir(dirname(output), { recursive: true });
const save = () => writeFile(output, `${JSON.stringify(result, null, 2)}\n`);

async function electronBuildHash() {
  const hash = createHash('sha256');
  for (const directory of ['out/main', 'out/preload']) {
    const base = join(artifactRoot, directory);
    for (const entry of (await readdir(base, { recursive: true, withFileTypes: true }))
      .filter(entry => entry.isFile()).sort((a, b) => join(a.parentPath, a.name).localeCompare(join(b.parentPath, b.name)))) {
      const path = join(entry.parentPath, entry.name);
      hash.update(relative(artifactRoot, path)).update('\0').update(await readFile(path)).update('\0');
    }
  }
  return hash.digest('hex');
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function until(check, timeoutMs = 60_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const value = await withTimeout(Promise.resolve().then(check), Math.max(1, deadline - performance.now()), 'Acceptance deadline expired');
    if (value) return value;
    await delay(100);
  }
  throw new Error('Acceptance deadline expired');
}

function processTree(pid) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,%cpu='], { encoding: 'utf8' })
    .trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const ids = new Set([pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, parent] of rows) if (ids.has(parent) && !ids.has(id)) { ids.add(id); changed = true; }
  }
  const owned = rows.filter(([id]) => ids.has(id));
  return { pids: owned.map(row => row[0]), processes: owned.length, rssMiB: owned.reduce((sum, row) => sum + row[2], 0) / 1024,
    cpuPercentSnapshot: owned.reduce((sum, row) => sum + row[3], 0) };
}

function summary(values) {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return { count: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted.at(-1) };
}

async function run(mode, index) {
  const state = await mkdtemp(join(tmpdir(), 'xopc-local-connection-'));
  const port = await freePort();
  const token = randomUUID();
  const base = `http://127.0.0.1:${port}`;
  const configPath = join(state, 'xopc.json');
  const workspace = join(state, 'workspace/main');
  await mkdir(workspace, { recursive: true });
  await writeFile(configPath, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port,
    auth: { mode: 'token', token } }, browser: { enabled: false } }));
  const fixtureModule = functional ? await import('./electron-local-connection-fixture.mjs') : undefined;
  const fixture = await fixtureModule?.createLocalConnectionFixture(state);
  const remoteProfilePath = join(state, 'electron/gateway-connections-v1/profiles.json');
  if (functional) {
    await mkdir(dirname(remoteProfilePath), { recursive: true });
    await writeFile(remoteProfilePath, '{deliberately-corrupt-remote-profile');
  }
  const env = localConnectionEnvironment(process.env, artifactRoot, state, configPath, workspace);
  const sample = { mode, index, passed: false, readyMs: null, configMs: [], sessionsMs: [] };
  result.samples.push(sample);
  let external;
  let application;
  let logs = '';
  const authenticated = () => fetch(`${base}/api/config`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1500),
  }).then(response => response.ok).catch(() => false);
  try {
    if (mode === 'reuse') {
      external = spawn(process.execPath, [join(artifactRoot, 'dist/src/cli/bin.js'), 'gateway', '--foreground',
        '--bind', 'loopback', '--port', String(port), '--no-hot-reload'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
      external.stdout.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
      external.stderr.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
      await until(async () => {
        assert(external.exitCode === null, 'External Gateway exited during startup');
        return authenticated();
      });
    }
    const start = performance.now();
    application = await _electron.launch({ args: [entry], cwd: root, env, timeout: 60_000 });
    application.process().stdout?.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
    application.process().stderr?.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
    const page = await until(async () => {
      for (const window of application.windows()) {
        if (!window.url().startsWith(base + '/')) continue;
        try {
          const ready = await window.evaluate(async () => Boolean(window.electronAPI)
            && (await fetch('/api/config', { signal: AbortSignal.timeout(2000) })).ok);
          if (ready) return window;
        } catch { /* Navigation can replace the initial recovery/loading document. */ }
      }
    });
    sample.readyMs = performance.now() - start;
    assert.equal((await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(2000) })).status, 401, 'Gateway still requires authentication');
    const count = index === 0 ? operations : 1;
    const metrics = await page.evaluate(async count => {
      const configMs = [], sessionsMs = [];
      for (let index = 0; index < count; index++) {
        for (const [path, values] of [['/api/config', configMs], ['/api/sessions', sessionsMs]]) {
          const start = performance.now();
          const response = await fetch(path, { signal: AbortSignal.timeout(2000) });
          if (!response.ok) throw new Error(`${path}: ${response.status}`);
          await response.json();
          values.push(performance.now() - start);
        }
      }
      const session = await fetch('/api/browser-session', { signal: AbortSignal.timeout(2000) });
      if (!session.ok) throw new Error('Browser Cookie bootstrap failed');
      return { configMs, sessionsMs, browserSession: true };
    }, count);
    Object.assign(sample, metrics);
    await until(() => page.evaluate(async () => (await window.electronAPI.computer.status())?.connected));
    sample.endpointConnected = true;
    sample.runtime = await application.evaluate(() => ({ node: process.versions.node, electron: process.versions.electron }));
    if (fixture) {
      sample.functional = await withTimeout(fixtureModule.verifyLocalConnectionFunctions(page, fixture, until), 90_000, 'Functional acceptance exceeded 90 seconds');
      assert.equal(await readFile(remoteProfilePath, 'utf8'), '{deliberately-corrupt-remote-profile', 'Local mode must not read or migrate remote profiles');
      sample.functional.corruptRemoteProfileIgnored = true;
      await until(() => page.evaluate(async () => {
        const response = await fetch('/api/runtime/quit-impact', { signal: AbortSignal.timeout(2000) });
        if (!response.ok) return false;
        return !(await response.json()).payload.shouldConfirm;
      }), 30_000);
      const restart = await withTimeout(page.evaluate(() => window.electronAPI.gateway.restart()),
        35_000, 'Gateway restart acceptance timed out');
      if (mode === 'spawn') {
        assert(restart.ok, `Owned Gateway restart failed: ${restart.message}`);
        await until(authenticated);
        await until(() => page.evaluate(async () => (await window.electronAPI.computer.status())?.connected));
        await page.reload();
        await page.getByRole('main').getByText('XOPC_LOCAL_CHAT_OK', { exact: true }).first().waitFor({ timeout: 30_000 });
        sample.functional.ownedRestartPreservesChat = true;
      } else {
        assert.equal(restart.ok, false, 'A reused service must not grant embedded restart authority');
        assert.match(restart.message, /not registered/);
        assert(await authenticated(), 'A refused restart must leave the external service available');
        sample.functional.externalRestartDenied = true;
      }
    }
    sample.resources = processTree(application.process().pid);
    await save();
    const shutdownStart = performance.now();
    let shutdownTimer;
    try {
      await Promise.race([application.close(), new Promise((_, reject) => {
        shutdownTimer = setTimeout(() => reject(new Error('Electron shutdown exceeded 15 seconds')), 15_000);
      })]);
    } finally { clearTimeout(shutdownTimer); }
    application = undefined;
    sample.shutdownMs = performance.now() - shutdownStart;
    if (mode === 'reuse') {
      assert(await authenticated(), 'Closing Electron must not stop an externally owned Gateway');
      sample.externalSurvived = true;
    } else {
      await until(async () => !(await authenticated()), 12_000);
      sample.ownedGatewayStopped = true;
    }
    sample.passed = true;
  } catch (error) {
    sample.error = String(error).replaceAll(token, '[redacted]');
    sample.windows = await Promise.all((application?.windows() ?? []).map(async page => ({
      url: page.url().slice(0, 160),
      text: (await page.locator('body').innerText({ timeout: 1000 }).catch(() => '')).slice(-3000).replaceAll(token, '[redacted]'),
      realtime: await withTimeout(page.evaluate(() => window.__connectionEvents?.slice(-10).map(event => ({
        kind: event.kind, event: event.payload?.event, code: event.payload?.code,
      }))), 1500, 'Realtime diagnostic timed out').catch(() => undefined),
    })));
    if (logs) sample.gatewayLogTail = logs.replaceAll(token, '[redacted]');
    throw error;
  } finally {
    if (application && application.process().exitCode === null && application.process().signalCode === null) {
      // A failing fixture can leave a native quit-confirmation dialog open.
      // Only reap this test instance's descendants, never an external/reused Gateway.
      for (const pid of processTree(application.process().pid).pids.reverse()) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* Already exited. */ }
      }
      await application.close().catch(() => {});
    }
    if (external && external.exitCode === null && external.signalCode === null) {
      const exited = once(external, 'exit');
      external.kill('SIGTERM');
      const timer = setTimeout(() => external.kill('SIGKILL'), 7000);
      await exited;
      clearTimeout(timer);
    }
    try { await save(); } finally {
      try { await fixture?.close(); } finally { await rm(state, { recursive: true, force: true }); }
    }
  }
}

try {
  cleanupLayout = await prepareLocalConnectionLayout(artifactRoot, root);
  result.electronBuildSha256 = await electronBuildHash();
  for (const mode of ['spawn', 'reuse']) for (let index = 0; index < runs; index++) {
    await run(mode, index);
    console.log(`${mode} ${index + 1}/${runs} passed`);
  }
  result.summary = Object.fromEntries(['spawn', 'reuse'].map(mode => {
    const samples = result.samples.filter(sample => sample.mode === mode);
    return [mode, { readyMs: summary(samples.map(sample => sample.readyMs)),
      configMs: summary(samples.flatMap(sample => sample.configMs)),
      sessionsMs: summary(samples.flatMap(sample => sample.sessionsMs)),
      shutdownMs: summary(samples.map(sample => sample.shutdownMs)),
      rssMiB: summary(samples.map(sample => sample.resources.rssMiB)) }];
  }));
  assert.equal(await electronBuildHash(), result.electronBuildSha256, 'Electron build changed during acceptance');
  result.passed = true;
  if (comparePath) {
    const baseline = JSON.parse(await readFile(resolve(comparePath), 'utf8'));
    assert(baseline.passed && baseline.runs === runs && baseline.operations === operations,
      'Comparison requires a passing baseline with the same sample plan');
    assert.equal(Boolean(baseline.functional), functional, 'Do not compare different workloads');
    assert.equal(baseline.platform, result.platform);
    assert.equal(baseline.arch, result.arch);
    assert.equal(baseline.node, result.node);
    const limits = { readyMs: 100, configMs: 5, sessionsMs: 5, rssMiB: 32 };
    result.comparison = [];
    for (const mode of ['spawn', 'reuse']) for (const [metric, absoluteTolerance] of Object.entries(limits)) {
      const before = baseline.summary[mode][metric].p95;
      const after = result.summary[mode][metric].p95;
      const maximum = before + Math.max(before * 0.05, absoluteTolerance);
      result.comparison.push({ mode, metric, before, after, maximum, passed: after <= maximum });
    }
    result.passed = result.comparison.every(metric => metric.passed);
    assert(result.passed, 'Local baseline regression budget exceeded; inspect comparison evidence');
  }
} catch (error) {
  result.passed = false;
  console.error(String(error));
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  if (cleanupLayout) {
    try { await save(); } finally { await cleanupLayout(); }
    console.log(`Report: ${output}`);
  }
}
