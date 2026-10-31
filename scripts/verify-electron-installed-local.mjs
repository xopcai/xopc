import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';


import { createLocalConnectionFixture, dismissLocalConnectionOnboarding, verifyLocalConnectionFunctions } from './electron-local-connection-fixture.mjs';
import { createAcceptanceOutput, localConnectionEnvironment, withTimeout } from './electron-local-connection-support.mjs';
import { installedAppFingerprint, killAcceptanceApplication, launchInstalledApplication, macPackagedTarget, packagedAcceptanceEnvironment, packagedGatewayEnvironment } from './electron-packaged-acceptance.mjs';

const root = resolve(import.meta.dirname, '..');
const appIndex = process.argv.indexOf('--app'); assert(appIndex >= 0 && process.argv[appIndex + 1]);
const target = await macPackagedTarget(process.argv[appIndex + 1]);
const externalIndex = process.argv.indexOf('--reuse-server-app');
const externalTarget = externalIndex < 0 ? target : await macPackagedTarget(process.argv[externalIndex + 1]);
const output = await createAcceptanceOutput(join(root, 'reports/s4-installed-local.json'));
const report = { passed: false, startedAt: new Date().toISOString(), scope: 'Installed macOS app local spawn/reuse, real bundled Gateway/SQLite/IPC/PTY/browser with deterministic inference; not upgrade or S5 acceptance', samples: [] };
async function until(check, budget = 30_000) { const deadline = Date.now() + budget; while (Date.now() < deadline) { if (await Promise.resolve().then(check).catch(() => false)) return; await delay(100); } throw new Error('Acceptance deadline exceeded'); }
report.packageBefore = await installedAppFingerprint(target.application);
if (externalIndex >= 0) report.externalServerPackageBefore = await installedAppFingerprint(externalTarget.application);
const databaseVersion = state => { const db = new DatabaseSync(join(state, 'xopc.db'), { readOnly: true }); try { return db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get()?.value; } finally { db.close(); } };
try {
  for (const mode of ['spawn', 'reuse']) {
    const state = await mkdtemp(join(tmpdir(), 'xopc-s4-local-'));
    let app, external, fixture;
    const token = randomUUID(); let logs = '';
    const sample = { mode, passed: false }; report.samples.push(sample);
    try {
      const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
      const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
      const config = join(state, 'xopc.json'), workspace = join(state, 'workspace/main'); await mkdir(workspace, { recursive: true });
      await writeFile(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port, auth: { mode: 'token', token } }, browser: { enabled: false } }));
      fixture = await createLocalConnectionFixture(state);
      const profile = join(state, 'electron/gateway-connections-v1/profiles.json'); await mkdir(dirname(profile), { recursive: true });
      await writeFile(profile, '{corrupt-remote-profile');
      const env = packagedAcceptanceEnvironment(localConnectionEnvironment(process.env, root, state, config, workspace));
      if (process.argv.includes('--lifecycle-diagnostics')) env.XOPC_ELECTRON_DEBUG_LIFECYCLE = '1';
      const healthy = () => fetch(`http://127.0.0.1:${port}/api/config`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1500) }).then(response => response.ok);
      if (mode === 'reuse') {
        external = spawn(externalTarget.executablePath, [externalTarget.server, 'gateway', '--foreground', '--bind', 'loopback', '--port', String(port), '--no-hot-reload'], { cwd: state, env: packagedGatewayEnvironment(env, externalTarget), stdio: ['ignore', 'pipe', 'pipe'] });
        external.stdout.on('data', chunk => { logs = (logs + chunk).slice(-8000); }); external.stderr.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
        await until(healthy, 60_000); sample.reusedDatabaseVersionBefore = databaseVersion(state);
      }
      app = await launchInstalledApplication(target, [], env, state, 60_000);
      sample.runtime = app.metadata; assert.equal(sample.runtime.cwd, state);
      const page = await app.firstWindow(); page.setDefaultTimeout(30_000);
      await until(() => page.evaluate(async () => location.protocol === 'http:' && (await fetch('/api/config')).ok), 30_000);
      await until(() => page.evaluate(async () => Boolean(window.electronAPI) && (await window.electronAPI.computer.status())?.connected), 60_000);
      sample.functions = await withTimeout(verifyLocalConnectionFunctions(page, fixture, until), 90_000, 'Functional acceptance exceeded 90 seconds');
      assert.equal(await readFile(profile, 'utf8'), '{corrupt-remote-profile'); sample.corruptRemoteProfileIgnored = true;
      await until(() => page.evaluate(() => fetch('/api/runtime/quit-impact').then(response => response.json()).then(data => !data.payload.shouldConfirm)));
      const restart = await withTimeout(page.evaluate(() => window.electronAPI.gateway.restart()), 35_000, 'Gateway restart acceptance timed out');
      if (mode === 'spawn') {
        assert(restart.ok); await until(healthy);
        await until(() => page.evaluate(async () => (await window.electronAPI.computer.status())?.connected));
        await page.reload(); await dismissLocalConnectionOnboarding(page);
        await page.getByRole('main').getByText('XOPC_LOCAL_CHAT_OK', { exact: true }).first().waitFor();
        sample.ownedRestartPreservesChat = true;
      } else { assert.equal(restart.ok, false); assert.match(restart.message, /not registered/); assert(await healthy()); sample.externalRestartDenied = true; }
      await withTimeout(app.close(), 15_000, 'Electron shutdown exceeded 15 seconds'); app = undefined;
      if (mode === 'reuse') { assert.equal(external.exitCode, null); assert(await healthy()); sample.reusedGatewaySurvivesExit = true; sample.reusedDatabaseVersionAfter = databaseVersion(state); assert.equal(sample.reusedDatabaseVersionAfter, sample.reusedDatabaseVersionBefore, 'Reusing a Gateway must not upgrade or take ownership of its database'); }
      else await until(() => healthy().then(value => !value, () => true), 15_000);
      sample.passed = true;
    } catch (error) {
      const redact = value => String(value).replaceAll(token, '[redacted]').replace(/Token: [^\n]+/g, 'Token: [redacted]');
      sample.error = redact(error?.stack ?? error); sample.logs = redact(logs + (app?.output() ?? ''));
      if (app) sample.windows = await Promise.all(app.windows().map(async page => ({ url: page.url(), text: redact(await page.locator('body').innerText().catch(() => '')) })));
      throw error;
    }
    finally {
      if (app) await withTimeout(app.close(), 10_000, 'Electron cleanup').catch(() => killAcceptanceApplication(app));
      if (external && external.exitCode === null && external.signalCode === null) { const exit = once(external, 'exit'); external.kill('SIGTERM'); await withTimeout(exit, 10_000, 'Gateway cleanup').catch(() => external.kill('SIGKILL')); }
      await fixture?.close();
      if (sample.passed) await rm(state, { recursive: true, force: true });
      else sample.failureStateDirectory = state;
    }
  }
  report.passed = true;
} catch { process.exitCode = 1; }
finally {
  report.packageAfter = await installedAppFingerprint(target.application);
  if (report.packageAfter.sha256 !== report.packageBefore.sha256) { report.passed = false; report.packageMutated = true; process.exitCode = 1; }
  if (externalIndex >= 0) { report.externalServerPackageAfter = await installedAppFingerprint(externalTarget.application); if (report.externalServerPackageAfter.sha256 !== report.externalServerPackageBefore.sha256) { report.passed = false; process.exitCode = 1; } }
  report.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
