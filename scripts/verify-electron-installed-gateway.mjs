// Real installed app against an explicitly provisioned independent Gateway and its configured model.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';


import { createAcceptanceOutput, localConnectionEnvironment, withTimeout } from './electron-local-connection-support.mjs';
import { installedAppFingerprint, killAcceptanceApplication, launchInstalledApplication, macPackagedTarget, packagedAcceptanceEnvironment } from './electron-packaged-acceptance.mjs';

const root = resolve(import.meta.dirname, '..');
const flag = name => { const index = process.argv.indexOf(name); assert(index >= 0 && process.argv[index + 1], `Missing ${name}`); return process.argv[index + 1]; };
const output = await createAcceptanceOutput(join(root, 'reports/remote-console-installed-external.json'));
const target = await macPackagedTarget(flag('--app'));
const connection = JSON.parse(await readFile(resolve(flag('--connection')), 'utf8'));
assert(['direct', 'ssh'].includes(connection.transport));
assert(connection.transport !== 'direct' || new URL(connection.origin).protocol === 'https:', 'Direct acceptance requires HTTPS');
const token = (await readFile(resolve(connection.credentialFile), 'utf8')).trim();
assert(token);
const state = await mkdtemp(join(tmpdir(), 'xopc-console-external-'));
const report = { passed: false, startedAt: new Date().toISOString(), scope: 'Installed macOS app against explicitly configured external Gateway; one real configured Agent/model input', transport: connection.transport, origin: new URL(connection.origin).origin, checks: {} };
let app;
async function devices() {
  const response = await fetch(connection.origin + '/api/endpoint-tools/devices', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  assert(response.ok, `Server device audit failed: ${response.status}`); return response.json();
}
const redact = value => String(value).replaceAll(token, '[redacted]');
async function until(check, budget = 30_000) {
  const deadline = Date.now() + budget;
  while (Date.now() < deadline) { if (await Promise.resolve().then(check).catch(() => false)) return; await delay(100); }
  throw new Error('Acceptance deadline exceeded');
}
try {
  report.packageBefore = await installedAppFingerprint(target.application);
  const devicesBefore = await devices();
  const config = join(state, 'xopc.json');
  await writeFile(config, '{invalid-local-config');
  const env = packagedAcceptanceEnvironment(localConnectionEnvironment(process.env, root, state, config, join(state, 'workspace')));
  app = await launchInstalledApplication(target, ['--gateway-connections'], env, state);
  report.runtime = app.metadata; assert.equal(report.runtime.cwd, state);
  const setup = await app.firstWindow(); setup.setDefaultTimeout(30_000);
  await setup.getByRole('heading', { name: /^Gateway 连接(?:预览|管理)$/ }).waitFor();
  const connected = await setup.evaluate(async ({ origin, transport, token }) => {
    let snapshot = await window.gatewayConnections.snapshot();
    const saved = await window.gatewayConnections.save(snapshot.epoch, { name: 'Independent server', origin, transport, credential: token });
    if (!saved.ok) return saved;
    snapshot = saved.snapshot;
    const profile = snapshot.profiles.find(profile => profile.name === 'Independent server');
    return window.gatewayConnections.connect(snapshot.epoch, profile.id);
  }, { origin: connection.origin, transport: connection.transport, token });
  assert(connected.ok, redact(JSON.stringify(connected)));
  const page = app.windows().find(page => page !== setup && new URL(page.url()).origin === new URL(connection.origin).origin); assert(page);
  let submitted = 0;
  const countInput = request => { if (request.method() === 'POST' && request.url().endsWith('/inputs')) submitted++; };
  page.on('request', countInput);
  page.setDefaultTimeout(30_000);
  await page.locator('[contenteditable="true"][role="textbox"]').waitFor();
  assert.equal(await page.evaluate(() => window.electronAPI), undefined);
  const response = await page.evaluate(() => fetch('/api/endpoint-tools/devices').then(response => response.status));
  assert.equal(response, 200);
  await page.locator('[contenteditable="true"][role="textbox"]').fill('Reply with exactly this text: REMOTE_CONSOLE_MODEL_OK');
  await page.locator('[contenteditable="true"][role="textbox"]').press('Enter');
  await until(() => page.locator('[data-chat-message-index]').allTextContents().then(parts => parts.length > 1 && parts.at(-1).includes('REMOTE_CONSOLE_MODEL_OK')), 30_000);
  const selectedHash = await page.evaluate(() => location.hash);
  report.checks.configuredRemoteAgentModel = true;
  report.checks.remoteConsoleHasNoLocalPreload = true;
  assert(!(await readdir(state)).some(name => ['xopc.db', 'workspace'].includes(name)));
  report.checks.noClientGatewayDatabaseOrWorkspace = true;
  assert.deepEqual(await devices(), devicesBefore); report.checks.noDesktopDeviceRegistered = true;
  const text = await page.locator('body').innerText(); assert(!text.includes(token));
  report.checks.credentialNotRendered = true;
  await page.close();
  await until(() => Promise.resolve(page.isClosed()));
  report.checks.consoleCleanup = true;
  const reopened = await setup.evaluate(async id => { const snapshot = await window.gatewayConnections.snapshot(); return window.gatewayConnections.connect(snapshot.epoch, id); }, connected.snapshot.selectedId);
  assert(reopened.ok);
  const history = app.windows().find(window => window !== setup && new URL(window.url()).origin === new URL(connection.origin).origin); assert(history);
  history.on('request', countInput);
  await history.evaluate(hash => { location.hash = hash; }, selectedHash);
  await until(() => history.locator('[data-chat-message-index]').allTextContents().then(parts => parts.length > 1 && parts.at(-1).includes('REMOTE_CONSOLE_MODEL_OK')));
  assert.equal(submitted, 1); report.checks.remoteHistoryReopenedWithoutResubmission = true;
  report.passed = true;
} catch (error) { report.error = redact(error?.stack ?? error); process.exitCode = 1; }
finally {
  if (app) await withTimeout(app.close(), 10_000, 'Installed Electron stop').catch(() => killAcceptanceApplication(app));
  report.packageAfter = await installedAppFingerprint(target.application);
  if (report.packageBefore?.sha256 !== report.packageAfter.sha256) { report.passed = false; report.packageMutated = true; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  await rm(state, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
