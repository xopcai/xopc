import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { createAcceptanceOutput, localConnectionEnvironment, withTimeout } from './electron-local-connection-support.mjs';
import { installedAppFingerprint, killAcceptanceApplication, launchInstalledApplication, macPackagedTarget, packagedAcceptanceEnvironment, packagedGatewayEnvironment } from './electron-packaged-acceptance.mjs';

// The supervisor drives Renderer controls only. Native consent must be clicked through native UI automation.
const root = resolve(import.meta.dirname, '..'), index = process.argv.indexOf('--app');
assert(index >= 0, 'An installed --app is required');
const target = await macPackagedTarget(process.argv[index + 1]);
const approvalOnly = process.argv.includes('--approval-only');
const output = await createAcceptanceOutput(join(root, 'reports/p2a2-native-enrollment.json'));
const state = await mkdtemp(join(tmpdir(), 'xopc-native-enrollment-')), token = randomUUID();
const report = { passed: false, startedAt: new Date().toISOString(), checks: {}, scope: 'Installed macOS application, actual OS safeStorage, native parented consent, independent bundled Gateway through SSH-loopback transport; no local tools or physical WAN claim', interactions: [] };
report.nativeCancelCovered = !approvalOnly;
let gateway, application, proxy, logs = '', offline = false;
const redact = value => String(value).replaceAll(token, '[redacted]').replace(/Token: [^\n]+/g, 'Token: [redacted]').replace(/xopc_(?:at|rt|pair)_[A-Za-z0-9_-]+/g, '[redacted-device-credential]');
async function until(probe, ms = 30000) {
  const end = Date.now() + ms;
  do { if (await probe()) return; await delay(150); } while (Date.now() < end);
  throw new Error('Acceptance condition deadline exceeded');
}
async function port() {
  const listener = http.createServer().listen(0, '127.0.0.1'); await once(listener, 'listening');
  const value = listener.address().port; await new Promise(resolve => listener.close(resolve)); return value;
}
try {
  report.packageBefore = await installedAppFingerprint(target.application);
  const serverState = join(state, 'gateway'); await mkdir(serverState);
  const serverPort = await port(), config = join(serverState, 'xopc.json');
  await writeFile(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port: serverPort, auth: { mode: 'token', token } }, browser: { enabled: false } }), { mode: 0o600 });
  gateway = spawn(target.executablePath, [target.server, 'gateway', '--foreground', '--bind', 'loopback', '--port', String(serverPort), '--no-hot-reload'], {
    cwd: state, env: packagedGatewayEnvironment(localConnectionEnvironment(process.env, root, serverState, config, join(serverState, 'workspace')), target), stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [gateway.stdout, gateway.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-16000); });
  const owner = async (path, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${serverPort}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    assert(response.ok, `Owner fixture ${path}: ${response.status}`); const json = await response.json(); return json.payload ?? json;
  };
  await until(() => owner('/api/desktop-host/compatibility').then(() => true).catch(() => false), 60000);
  proxy = http.createServer((req, res) => {
    if (offline) { res.writeHead(503).end('{}'); return; }
    const upstream = http.request({ host: '127.0.0.1', port: serverPort, path: req.url, method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    upstream.on('error', () => res.destroy()); req.pipe(upstream);
  }).listen(0, '127.0.0.1'); await once(proxy, 'listening');
  const origin = `http://127.0.0.1:${proxy.address().port}`;
  const client = join(state, 'client'); await mkdir(client); const clientConfig = join(client, 'xopc.json');
  await writeFile(clientConfig, '{invalid-local-config');
  const env = packagedAcceptanceEnvironment(localConnectionEnvironment(process.env, root, client, clientConfig, join(client, 'workspace')));
  const launch = async () => {
    application = await launchInstalledApplication(target, ['--gateway-connections'], env, state);
    report.runtime = application.metadata; const page = await application.firstWindow(); page.setDefaultTimeout(30000);
    await page.getByRole('heading', { name: 'Gateway 连接预览' }).waitFor(); return page;
  };
  let page = await launch();
  const save = async credential => {
    const response = await page.evaluate(async ({ origin, credential }) => {
      const api = window.gatewayConnections, snapshot = await api.snapshot(), existing = snapshot.profiles.find(profile => profile.name === 'Native enrollment');
      const result = await api.save(snapshot.epoch, { ...(existing ? { id: existing.id } : {}), name: 'Native enrollment', origin, transport: 'ssh', credential });
      if (!result.ok) return result;
      const id = result.snapshot.profiles.find(profile => profile.name === 'Native enrollment').id;
      return api.select(result.snapshot.epoch, id);
    }, { origin, credential }); assert(response.ok, response.error);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    return response.snapshot.profiles.find(profile => profile.name === 'Native enrollment').id;
  };
  const id = await save(token);
  const connection = await page.evaluate(async id => { const api = window.gatewayConnections, state = await api.snapshot(); return api.connect(state.epoch, id); }, id);
  assert(connection.ok, connection.error);
  const chat = application.windows().find(item => item !== page); assert(chat);
  await chat.locator('#recover').click(); await until(() => Promise.resolve(chat.isClosed()));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const snapshot = () => page.evaluate(() => window.gatewayConnections.snapshot());
  const deviceStatus = async () => (await snapshot()).desktop[id];
  const action = async kind => {
    await page.locator(`[data-profile="${id}"][data-desktop="${kind}"]`).evaluate(button => { if (button.disabled) throw new Error('Desktop action disabled'); button.click(); });
    await until(async () => await page.locator('#profiles').getAttribute('aria-busy') !== 'true', 120000);
  };
  const native = async (kind, label) => {
    const item = { label, startedAt: new Date().toISOString(), status: 'waiting-for-native-click', pid: application.process().pid };
    report.interactions.push(item); console.log(`NATIVE CONSENT ${label}; choose the actual native dialog button; PID ${item.pid}`);
    await writeFile(output + '.interaction.json', JSON.stringify(item, null, 2));
    await action(kind); item.finishedAt = new Date().toISOString(); item.status = 'native-dialog-returned';
  };
  if (!approvalOnly) {
    await native('enroll', 'cancel first enrollment');
    assert.equal((await deviceStatus()).state, 'cancelled');
    assert.equal((await owner('/api/endpoint-tools/devices')).filter(device => device.platform === 'desktop').length, 0);
    report.checks.nativeCancelCreatesNoDevice = true;
  }
  await native('enroll', 'approve first enrollment');
  assert.equal((await deviceStatus()).state, 'registered'); const firstId = (await deviceStatus()).deviceId;
  report.checks.nativeApprovalCreatesIndependentIdentity = true;
  await application.close(); page = await launch();
  const selected = await page.evaluate(async id => { const api = window.gatewayConnections, state = await api.snapshot(); return api.select(state.epoch, id); }, id);
  assert(selected.ok, selected.error);
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await action('check');
  assert.equal((await deviceStatus()).deviceId, firstId); report.checks.osSafeStorageSurvivesRestart = true;
  await save(randomUUID()); await action('check'); assert.equal((await deviceStatus()).state, 'registered');
  assert.equal((await deviceStatus()).deviceId, firstId); report.checks.deviceCheckIndependentOfOwnerCredential = true;
  await save(token); offline = true; await action('disable');
  assert.equal((await deviceStatus()).state, 'disabled-unconfirmed');
  await action('check'); assert.notEqual((await deviceStatus()).state, 'registered');
  offline = false; await action('disable'); assert.equal((await deviceStatus()).state, 'disabled-confirmed');
  report.checks.offlineLocalDisableAndOnlineConfirmation = true;
  if (!approvalOnly) { await native('enroll', 'cancel replacement enrollment'); assert.equal((await deviceStatus()).state, 'disabled-confirmed'); }
  await native('enroll', 'approve replacement enrollment');
  assert.equal((await deviceStatus()).state, 'registered'); const secondId = (await deviceStatus()).deviceId; assert.notEqual(firstId, secondId);
  report.checks.replacementRequiresFreshNativeConsent = true;
  await owner('/api/endpoint-tools/devices/revoke', 'POST', { ids: [secondId] }); await action('check');
  assert.equal((await deviceStatus()).state, 'disabled-unconfirmed');
  await action('check'); assert.equal((await deviceStatus()).state, 'disabled-unconfirmed');
  assert.equal((await owner('/api/endpoint-tools/devices')).filter(device => device.platform === 'desktop').length, 2);
  report.checks.externalRevocationNeverAutoReenrolls = true;
  const identities = join(env.XOPC_ELECTRON_USER_DATA_DIR, 'gateway-connections-v1/desktop-identities');
  const files = await readdir(identities); assert.equal(files.length, 1);
  const stored = await readFile(join(identities, files[0]));
  assert(!stored.includes(Buffer.from('PRIVATE KEY')) && !stored.includes(Buffer.from('xopc_rt_')));
  assert.equal((await stat(join(identities, files[0]))).mode & 0o777, 0o600);
  assert(!JSON.stringify(await snapshot()).match(/PRIVATE KEY|xopc_rt_|xopc_at_|credentialRef/));
  assert.equal(await readFile(clientConfig, 'utf8'), '{invalid-local-config');
  assert(!(await readdir(client)).includes('xopc.db')); assert(!(await readdir(client)).includes('workspace'));
  report.checks.encryptedIdentityAndNoLocalGatewayDatabase = true;
  const devices = await owner('/api/endpoint-tools/devices');
  for (const device of devices.filter(device => device.platform === 'desktop')) {
    assert.deepEqual(device.access.scopes, ['gateway.status', 'device.self']); assert.equal(device.endpoints.length, 0); assert.equal(device.principal, null);
  }
  report.checks.noEndpointRegistrationOrLocalTools = true;
  await application.close(); application = undefined;
  report.packageAfter = await installedAppFingerprint(target.application); assert.deepEqual(report.packageAfter, report.packageBefore);
  report.passed = true;
} catch (error) { report.error = redact(error.stack ?? error); report.logs = redact(logs); report.applicationOutput = redact(error.installedApplicationOutput ?? application?.output() ?? ''); process.exitCode = 1; }
finally {
  if (application) { try { await application.close(); } catch { killAcceptanceApplication(application); } }
  proxy?.closeAllConnections(); if (proxy) await new Promise(resolve => proxy.close(resolve));
  if (gateway?.exitCode === null) {
    try { const stopped = once(gateway, 'exit'); gateway.kill('SIGTERM'); await withTimeout(stopped, 10000, 'Enrollment fixture stop'); }
    catch { gateway.kill('SIGKILL'); report.cleanupFailure = true; report.passed = false; process.exitCode = 1; }
  }
  if (report.passed) await rm(state, { recursive: true, force: true }); else report.failureStateDirectory = state;
  report.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
