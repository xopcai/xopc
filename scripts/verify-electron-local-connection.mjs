// Exercise one desktop window across two real Gateways without touching the user's data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { _electron } from 'playwright-core';

import { createAcceptanceOutput, localConnectionEnvironment, prepareLocalConnectionLayout, withTimeout } from './electron-local-connection-support.mjs';

const root = resolve(import.meta.dirname, '..');
const state = await mkdtemp(join(tmpdir(), 'xopc-unified-gateway-'));
const output = await createAcceptanceOutput(join(tmpdir(), 'xopc-unified-gateway-' + randomUUID() + '.json'));
const report = { passed: false, checks: {} };
let application, remote, cleanupLayout;
let remoteLogs = '';
async function port() { const server = createServer().listen(0, '127.0.0.1'); await once(server, 'listening'); const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value; }
async function until(test, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await test().catch(() => false)) return; await delay(100); }
  throw new Error('Gateway acceptance timed out');
}
const localToken = randomUUID(), remoteToken = randomUUID();
const redact = text => String(text).replaceAll(localToken, '[redacted]').replaceAll(remoteToken, '[redacted]').replace(/Token: [^\n]+/g, 'Token: [redacted]');
try {
  const client = join(state, 'client'), server = join(state, 'server'); await mkdir(client); await mkdir(server);
  const localPort = await port(), remotePort = await port();
  const clientConfig = join(client, 'xopc.json'), serverConfig = join(server, 'xopc.json');
  await writeFile(clientConfig, JSON.stringify({ gateway: { port: localPort, bind: 'loopback', auth: { mode: 'token', token: localToken } }, browser: { enabled: false } }));
  await writeFile(serverConfig, JSON.stringify({ gateway: { port: remotePort, bind: 'loopback', auth: { mode: 'token', token: remoteToken } }, browser: { enabled: false } }));
  await mkdir(join(client, 'electron'), { recursive: true });
  const policyPath = join(client, 'electron/computer-access-policy.json');
  const policy = JSON.stringify({ version: 1, authorizedAppIds: ['com.example.PreviouslyAuthorized'] }); await writeFile(policyPath, policy);
  remote = spawn(process.execPath, [join(root, 'dist/src/cli/bin.js'), 'gateway', '--foreground', '--bind', 'loopback', '--port', String(remotePort), '--no-hot-reload'], {
    cwd: root, env: localConnectionEnvironment(process.env, root, server, serverConfig, join(server, 'workspace')), stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [remote.stdout, remote.stderr]) stream.on('data', value => { remoteLogs = (remoteLogs + value).slice(-12000); });
  const remoteOrigin = `http://127.0.0.1:${remotePort}`;
  await until(async () => (await fetch(remoteOrigin + '/api/browser-session', { headers: { Authorization: `Bearer ${remoteToken}` } })).ok);
  cleanupLayout = await prepareLocalConnectionLayout(root);
  application = await _electron.launch({ args: [join(root, 'out/main/index.js')], cwd: root,
    env: localConnectionEnvironment(process.env, root, client, clientConfig, join(client, 'workspace')), timeout: 30000 });
  let page = await application.firstWindow(); page.setDefaultTimeout(30000);
  await until(async () => page.evaluate(() => !!window.electronAPI?.gateway?.connection));
  await until(async () => page.evaluate(async () => (await fetch('/api/browser-session')).ok));
  const before = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('http:')).id);
  const rendererOrigin = new URL(page.url()).origin;
  const localSession = await page.evaluate(() => fetch('/api/browser-session').then(response => response.json()));
  await until(() => page.evaluate(async () => (await window.electronAPI.computer.status()).connected));
  const localClaim = await page.evaluate(async () => (await window.electronAPI.computer.status()).claim.endpointId);
  const local = await page.evaluate(() => window.electronAPI.gateway.connection()); assert.equal(local.mode, 'local');
  assert.equal(new URL(local.origin).port, String(localPort));
  report.checks.localRendererAndEndpointReady = true;
  const result = await page.evaluate(async ({ origin, credential }) => window.electronAPI.gateway.switchConnection({ mode: 'remote', origin, credential }), { origin: remoteOrigin, credential: remoteToken });
  assert(result.ok, result.error);
  await until(() => page.evaluate(async () => (await window.electronAPI.gateway.connection()).mode === 'remote'));
  await until(() => page.evaluate(async () => (await fetch('/api/browser-session')).ok));
  const remoteSession = await page.evaluate(() => fetch('/api/browser-session').then(response => response.json()));
  assert.notEqual(remoteSession.conversationId, localSession.conversationId);
  assert.equal(new URL(page.url()).origin, rendererOrigin);
  assert.equal(await application.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.webContents.getURL().startsWith('http:'), before), true);
  assert.equal(await page.evaluate(() => typeof window.gatewayConnections), 'undefined');
  assert.equal(await page.locator('#root').count(), 1);
  assert.equal(await application.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().startsWith(origin)).length, rendererOrigin), 1);
  await page.screenshot({ path: '/tmp/xopc-unified-remote-main.png' });
  if (process.argv.includes('--settings-design')) {
    await page.evaluate(() => {
      localStorage.setItem('xopc.language', 'zh');
      localStorage.setItem('xopc-web-settings-mode', JSON.stringify({ state: { mode: 'advanced' }, version: 0 }));
      location.hash = '/settings/gateway';
    });
    await page.reload();
    await page.getByRole('heading', { name: 'Gateway', exact: true }).waitFor();
    const dismiss = page.getByRole('button', { name: '跳过 — 稍后再设置' });
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
    await page.getByRole('heading', { name: '服务配置', exact: true }).waitFor();
    await page.getByText('更改连接', { exact: true }).waitFor();
    assert.equal(await page.getByText('本机服务', { exact: true }).count(), 0);
    assert(!(await page.locator('body').innerText()).includes(rendererOrigin));
    await page.screenshot({ path: '/tmp/xopc-settings-gateway-overview.png' });
    await page.getByRole('button', { name: '更改连接', exact: true }).click();
    await page.getByRole('heading', { name: '更改 Gateway 连接' }).waitFor();
    await page.screenshot({ path: '/tmp/xopc-settings-gateway-edit.png' });
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.setViewportSize({ width: 520, height: 1000 });
    // Crossing the settings shell portal breakpoint remounts the route content.
    await page.getByRole('button', { name: '更改连接', exact: true }).click();
    await page.getByRole('heading', { name: '更改 Gateway 连接' }).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: '/tmp/xopc-settings-gateway-narrow.png' });
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.setViewportSize({ width: 1200, height: 850 });
    report.checks.settingsNavigationAndGatewayDesign = true;
  }
  report.checks.sameWindowAndBundledUiAcrossGateways = true;
  await until(() => page.evaluate(async () => (await window.electronAPI.computer.status()).connected));
  const remoteClaim = await page.evaluate(async () => (await window.electronAPI.computer.status()).claim.endpointId); assert.notEqual(remoteClaim, localClaim);
  const devices = await (await fetch(remoteOrigin + '/api/endpoint-tools/devices', { headers: { Authorization: `Bearer ${remoteToken}` } })).json();
  assert(JSON.stringify(devices).includes(remoteClaim));
  assert.equal(await readFile(policyPath, 'utf8'), policy);
  report.checks.authorizedLocalEndpointRegisteredOnRemote = true;
  const persisted = await readFile(join(client, 'electron/desktop-gateway.json'), 'utf8'); assert(!persisted.includes(remoteToken));
  report.checks.credentialEncrypted = true;
  // A failed destination must leave the current Gateway and native claim intact.
  const invalid = await page.evaluate(async () => window.electronAPI.gateway.switchConnection({ mode: 'remote', origin: 'http://public.invalid', credential: 'invalid' }));
  assert.equal(invalid.ok, false); assert.equal((await page.evaluate(() => window.electronAPI.gateway.connection())).mode, 'remote');
  report.checks.failedSwitchPreservesActiveGateway = true;
  const back = await page.evaluate(() => window.electronAPI.gateway.switchConnection({ mode: 'local' })); assert(back.ok, back.error);
  await until(() => page.evaluate(async () => (await fetch('/api/browser-session')).ok));
  const again = await page.evaluate(() => fetch('/api/browser-session').then(response => response.json()));
  assert.equal(again.conversationId, localSession.conversationId); assert.equal(new URL(page.url()).origin, rendererOrigin);
  await until(() => page.evaluate(async () => (await window.electronAPI.computer.status()).connected));
  assert.equal(await readFile(policyPath, 'utf8'), policy);
  report.checks.switchBackPreservesLocalDataAndPermissions = true;
  const reconnect = await page.evaluate(({ origin, credential }) => window.electronAPI.gateway.switchConnection({ mode: 'remote', origin, credential }), { origin: remoteOrigin, credential: remoteToken });
  assert(reconnect.ok, reconnect.error);
  await until(() => page.evaluate(async () => (await window.electronAPI.gateway.connection()).mode === 'remote'));
  const localDatabase = await stat(join(client, 'xopc.db'));
  await withTimeout(application.close(), 10000, 'Restart cleanup'); application = undefined;
  application = await _electron.launch({ args: [join(root, 'out/main/index.js')], cwd: root,
    env: localConnectionEnvironment(process.env, root, client, clientConfig, join(client, 'workspace')), timeout: 30000 });
  page = await application.firstWindow();
  await until(() => page.evaluate(async () => (await window.electronAPI.gateway.connection()).mode === 'remote'));
  await until(() => page.evaluate(async () => (await fetch('/api/browser-session')).ok));
  assert.equal((await stat(join(client, 'xopc.db'))).mtimeMs, localDatabase.mtimeMs);
  assert.equal(new URL(page.url()).origin, rendererOrigin);
  report.checks.stableClientStorageAcrossRestart = true;
  report.checks.restartRestoresRemoteConnection = true;
  report.checks.remoteStartupDoesNotOpenLocalDatabase = true;
  await withTimeout(application.close(), 10000, 'Offline restart cleanup'); application = undefined;
  const remoteExit = once(remote, 'exit'); remote.kill('SIGTERM'); await remoteExit; remote = undefined;
  application = await _electron.launch({ args: [join(root, 'out/main/index.js')], cwd: root,
    env: localConnectionEnvironment(process.env, root, client, clientConfig, join(client, 'workspace')), timeout: 30000 });
  page = await application.firstWindow();
  const connectionPanel = page.locator('section[aria-label="桌面 Gateway 连接"], section[aria-label="Desktop Gateway connection"]');
  await connectionPanel.waitFor();
  await connectionPanel.getByRole('button', { name: /^(连接到|Connect to)$/ }).click();
  await page.getByRole('button', { name: /^(本地 Gateway|Local Gateway)$/ }).click();
  await connectionPanel.getByRole('button', { name: /^(连接并切换|Connect and switch)$/ }).click();
  await until(() => page.evaluate(async () => (await window.electronAPI.gateway.connection()).mode === 'local'));
  await until(() => page.evaluate(async () => (await fetch('/api/browser-session')).ok));
  report.checks.offlineRemoteRecoveryThroughSameWindow = true;
  report.passed = true;
} catch (error) {
  report.error = redact(error?.stack ?? error); report.gatewayLogs = redact(remoteLogs); process.exitCode = 1;
  if (application) report.windows = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ id: window.id, url: window.webContents.getURL() }))).catch(() => []);
} finally {
  if (application) await withTimeout(application.close(), 10000, 'Desktop cleanup').catch(() => application.process()?.kill('SIGKILL'));
  if (remote) { remote.kill('SIGTERM'); await withTimeout(once(remote, 'exit'), 10000, 'Remote Gateway cleanup').catch(() => remote.kill('SIGKILL')); }
  await cleanupLayout?.();
  await writeFile(output, JSON.stringify(report, null, 2));
  await writeFile('/tmp/xopc-unified-gateway-acceptance.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (report.passed) await rm(state, { recursive: true, force: true });
  else console.log('Failure fixture retained at ' + state);
}
