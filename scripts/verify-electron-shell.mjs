import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import https from 'node:https';
import { connect, createServer } from 'node:net';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

import { _electron } from 'playwright-core';
import { createAcceptanceOutput, localConnectionEnvironment, prepareLocalConnectionLayout, withTimeout } from './electron-local-connection-support.mjs';

const tls = process.argv.includes('--tls');
const untrusted = process.argv.includes('--untrusted');
const cleanupFailure = process.argv.includes('--cleanup-failure');
const wrongHost = process.argv.includes('--wrong-host');
const root = resolve(import.meta.dirname, '..');
const output = await createAcceptanceOutput(join(root, 'reports/s2-shell-e2e.json'));
const state = await mkdtemp(join(tmpdir(), 'xopc-s2-shell-'));
const cleanupLayout = await prepareLocalConnectionLayout(root);
const report = { tls, untrusted, wrongHost, cleanupFailure, passed: false, startedAt: new Date().toISOString(), checks: {}, scope: 'S2 production main/preloads/utility worker and independent real Gateway; development Electron, not installer or S3 chat' };
let app, gateway, tlsProxy;
const proxySockets = new Set();
let gatewayLogs = '';
let testToken;
const redact = text => (testToken ? String(text).replaceAll(testToken, '[redacted]') : String(text)).replace(/Token: [^\n]+/g, 'Token: [redacted]');
try {
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const gatewayState = join(state, 'gateway'); await mkdir(gatewayState);
  let tlsConfig;
  if (tls) {
    const certPath = join(state, 'fixture-cert.pem'), keyPath = join(state, 'fixture-key.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
      '-addext', `subjectAltName=${wrongHost ? 'DNS:localhost' : 'IP:127.0.0.1,DNS:localhost'}`, '-keyout', keyPath, '-out', certPath], { stdio: 'ignore' });
    tlsConfig = { enabled: true, autoGenerate: false, certPath, keyPath };
  }
  let publicPort = port;
  if (tls) {
    tlsProxy = https.createServer({ cert: await readFile(tlsConfig.certPath), key: await readFile(tlsConfig.keyPath) }, (req, res) => {
      const upstream = http.request({ hostname: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      }); upstream.on('error', () => { res.writeHead(502).end(); }); req.pipe(upstream);
    });
    tlsProxy.on('connection', socket => { proxySockets.add(socket); socket.once('close', () => proxySockets.delete(socket)); });
    tlsProxy.on('upgrade', (req, socket, head) => {
      const backend = connect(port, '127.0.0.1', () => {
        const headers = req.rawHeaders.reduce((lines, value, index, raw) => index % 2 ? lines : lines + value + ': ' + raw[index + 1] + '\r\n', '');
        backend.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n`);
        if (head.length) backend.write(head); socket.pipe(backend).pipe(socket);
      }); backend.on('error', () => socket.destroy()); socket.on('error', () => backend.destroy()); socket.once('close', () => backend.destroy());
    });
    tlsProxy.listen(0, '127.0.0.1'); await once(tlsProxy, 'listening'); publicPort = tlsProxy.address().port;
  }
  const token = randomUUID(); testToken = token; const config = join(gatewayState, 'xopc.json');
  await writeFile(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port, corsOrigins: [`${tls ? 'https' : 'http'}://127.0.0.1:${publicPort}`], auth: { mode: 'token', token } }, browser: { enabled: false } }));
  const env = localConnectionEnvironment(process.env, root, gatewayState, config, join(gatewayState, 'workspace'));
  const startGateway = () => {
  gateway = spawn(process.execPath, [join(root, 'dist/src/cli/bin.js'), 'gateway', '--foreground', '--bind', 'loopback', '--port', String(port), '--no-hot-reload'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  gateway.stdout.on('data', chunk => { gatewayLogs = (gatewayLogs + chunk).slice(-8000); });
  gateway.stderr.on('data', chunk => { gatewayLogs = (gatewayLogs + chunk).slice(-8000); });
  };
  const stopGateway = async () => { const exited = once(gateway, 'exit'); gateway.kill('SIGTERM'); await withTimeout(exited, 10_000, 'Gateway stop').catch(() => { gateway.kill('SIGKILL'); return withTimeout(exited, 5000, 'Gateway kill confirmation'); }); };
  startGateway();
  const origin = `${tls ? 'https' : 'http'}://127.0.0.1:${publicPort}`;
  const ownerOrigin = wrongHost ? `https://localhost:${publicPort}` : origin;
  const certificate = tls ? await readFile(tlsConfig.certPath) : undefined;
  const owner = path => !tls ? fetch(origin + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) })
    : new Promise((resolve, reject) => {
      const req = https.get(ownerOrigin + path, { ca: certificate, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) }, res => {
        const chunks = []; res.on('data', data => chunks.push(data)); res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, json: async () => JSON.parse(Buffer.concat(chunks).toString()) }));
      }); req.on('error', reject);
    });
  const deadline = Date.now() + 60_000;
  while (!(await owner('/api/desktop-chat/bootstrap').then(r => r.ok).catch(() => false))) {
    assert(gateway.exitCode === null, 'Gateway exited before authentication'); assert(Date.now() < deadline, 'Gateway startup deadline'); await delay(100);
  }
  if (!tls) assert.equal((await fetch(origin + '/api/desktop-chat/bootstrap')).status, 401);
  const discovery = await (await owner('/api/desktop-chat/bootstrap')).json();
  assert(discovery.payload.gatewayId && discovery.payload.publicKey && discovery.payload.manifest.contract === 'xopc.desktop-chat.v1');
  report.checks.realAuthenticatedLazyRoute = true;
  const devicesBefore = await (await owner('/api/endpoint-tools/devices')).json();
  const clientState = join(state, 'client'); await mkdir(clientState);
  const localConfig = join(clientState, 'xopc.json'); await writeFile(localConfig, '{invalid-local-config-must-not-be-read');
  const clientEnv = localConnectionEnvironment(process.env, root, clientState, localConfig, join(clientState, 'workspace'));
  if (tls && !untrusted) clientEnv.NODE_EXTRA_CA_CERTS = tlsConfig.certPath;
  app = await _electron.launch({ args: [join(root, 'out/main/index.js'), '--gateway-connections'], cwd: root, env: clientEnv, timeout: 30_000 });
  const setup = await app.firstWindow(); await setup.getByRole('heading', { name: 'Gateway 连接预览' }).waitFor();
  const saved = await setup.evaluate(({ origin, token }) => window.gatewayConnections.save(0, { name: 'Independent Gateway', origin, transport: origin.startsWith('https:') ? 'direct' : 'ssh', credential: token }), { origin, token });
  assert(saved.ok);
  const connected = await setup.evaluate(({ epoch, id }) => window.gatewayConnections.connect(epoch, id), { epoch: saved.snapshot.epoch, id: saved.snapshot.profiles[0].id });
  if (untrusted || wrongHost) {
    assert.equal(connected.ok, false); assert.equal(connected.error, 'GATEWAY_TLS_FAILED');
    assert.equal(app.windows().length, 1); report.checks.certificateFailureHasNoShellOrFallback = true;
    report.passed = true;
  } else {
  assert(connected.ok, `S2 connection failed: ${JSON.stringify(connected)}`);
  const shell = app.windows().find(window => window !== setup && window.url().startsWith('http://127.0.0.1:'));
  assert(shell, 'Shell window was not created');
  await shell.getByText('身份与聊天传输契约已核验；S2 会话已建立。', { exact: true }).waitFor({ timeout: 20_000 });
  assert.equal(await shell.evaluate(() => window.electronAPI), undefined);
  assert.equal(await shell.evaluate(() => window.gatewayConnections), undefined);
  const partition = await app.evaluate(({ BrowserWindow }, url) => {
    const value = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url).webContents.session;
    return { persistent: value.isPersistent(), storagePath: value.getStoragePath() };
  }, shell.url());
  assert.deepEqual(partition, { persistent: false, storagePath: null }); report.checks.memoryOnlyPartition = true;

  const summary = await shell.evaluate(async () => ({ session: await (await fetch('/api/browser-session')).json(), cookie: document.cookie,
    allowed: (await fetch('/api/models')).status, denied: (await fetch('/api/config')).status, files: (await fetch('/api/files')).status }));
  assert.equal(summary.session.authenticated, true); assert.equal(summary.session.localCapabilities, false);
  assert.equal(summary.session.gatewayId, discovery.payload.gatewayId); assert.equal(summary.cookie, '');
  assert.equal(summary.allowed, 200); assert.equal(summary.denied, 403); assert.equal(summary.files, 403);
  assert(!JSON.stringify(summary).includes(token));
  const profile = JSON.parse(await readFile(join(clientState, 'electron/gateway-connections-v1/profiles.json'), 'utf8'));
  assert.equal(profile.profiles[0].identity.gatewayId, discovery.payload.gatewayId);
  report.checks.identityPinnedHttpOnlyAndRouteIsolation = true;
  const staleConnect = await setup.evaluate(({ epoch, id }) => window.gatewayConnections.connect(epoch, id), { epoch: saved.snapshot.epoch, id: saved.snapshot.profiles[0].id });
  assert.equal(staleConnect.ok, false); assert.equal(staleConnect.error, 'STALE_CONNECTION_EPOCH');
  assert(!shell.isClosed()); assert.equal(await shell.evaluate(async () => (await fetch('/api/models')).status), 200);
  report.checks.staleConfigRequestCannotCloseActiveShell = true;

  const realtime = await shell.evaluate(async () => {
    const clientId = crypto.randomUUID();
    const response = await fetch('/api/realtime/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, clientKind: 'web', protocolVersion: 2 }) });
    const data = await response.json(); if (!response.ok) throw new Error(JSON.stringify(data));
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(location.origin.replace('http', 'ws') + '/api/realtime/v1/ws');
      const timer = setTimeout(() => { ws.close(); reject(new Error('Shell realtime deadline')); }, 15_000);
      ws.onopen = () => ws.send(JSON.stringify({ protocolVersion: 2, messageId: crypto.randomUUID(), sentAt: Date.now(), kind: 'realtime.hello', payload: { ticket: data.payload.ticket, clientId, clientKind: 'web', subscriptions: [] } }));
      ws.onmessage = event => { const value = JSON.parse(event.data); if (value.kind === 'realtime.ready') { clearTimeout(timer); ws.close(); resolve({ ready: true, endpoint: value.payload.endpoint }); } };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('Shell websocket failed')); };
    });
  });
  assert.deepEqual(realtime, { ready: true, endpoint: undefined }); report.checks.realRealtimeWithoutEndpoint = true;
  const shellOrigin = new URL(shell.url()).origin;
  assert.equal((await fetch(shellOrigin + '/api/models')).status, 401);
  assert.equal((await setup.evaluate(async shellOrigin => { try { return (await fetch(shellOrigin + '/api/models')).status; } catch { return 'blocked'; } }, shellOrigin)), 'blocked');
  const probePreload = join(state, 'probe.cjs');
  await writeFile(probePreload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('probe',{invoke:c=>ipcRenderer.invoke(c),send:c=>ipcRenderer.send(c),port:c=>{const p=new MessageChannel();ipcRenderer.postMessage(c,{},[p.port1]);p.port2.close();}});`);
  const inventory = JSON.parse(await readFile(join(root, 'docs/design/evidence/electron-gateway-p2a1-s0-s1/s0-legacy-ipc-inventory.json'), 'utf8'));
  const channels = inventory.channels.map(value => value.channel);
  await app.evaluate(async ({ BrowserWindow, ipcMain }, { url, probePreload, channels }) => {
    globalThis.__s2Effects = 0;
    for (const channel of channels) { ipcMain.handle(channel, () => { globalThis.__s2Effects++; }); ipcMain.prependListener(channel, () => { globalThis.__s2Effects++; }); }
    const actual = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url);
    const probe = new BrowserWindow({ show: false, webPreferences: { session: actual.webContents.session, preload: probePreload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await probe.loadURL(url);
  }, { url: shell.url(), probePreload, channels });
  const rogue = app.windows().find(window => window !== shell && window !== setup);
  assert(rogue);
  assert.equal(await rogue.evaluate(async () => (await fetch('/api/models')).status), 401);
  const refused = await rogue.evaluate(async channels => {
    const results = [];
    for (const channel of [...channels, 'connections:snapshot', 'shell:bootstrap']) {
      results.push(await window.probe.invoke(channel).then(() => false, () => true));
      if (channels.includes(channel)) { window.probe.send(channel); window.probe.port(channel); }
    }
    return results.every(Boolean);
  }, channels);
  assert(refused); assert.equal(await app.evaluate(() => globalThis.__s2Effects), 0);
  await rogue.close(); report.checks.sameCookieWindowAndLegacyIpcDenied = channels.length;
  const bootstrapAgain = await shell.evaluate(() => window.desktopShell.bootstrap().then(() => false, () => true));
  assert(bootstrapAgain); report.checks.crossWindowAndBootstrapReplayDenied = true;
  assert.deepEqual(await (await owner('/api/endpoint-tools/devices')).json(), devicesBefore);
  assert.equal(await readFile(localConfig, 'utf8'), '{invalid-local-config-must-not-be-read');
  assert(!(await readdir(clientState, { recursive: true })).some(path => path.endsWith('xopc.db') || path.startsWith('workspace')));
  report.checks.noLocalGatewayDatabaseHostOrWorkspace = true;
  if (cleanupFailure) {
    await app.evaluate(({ BrowserWindow }, url) => {
      const window = BrowserWindow.getAllWindows().find(value => value.webContents.getURL() === url);
      window.webContents.session.clearStorageData = async () => { throw new Error('Injected cleanup failure'); };
    }, shell.url());
    const closed = shell.waitForEvent('close');
    await shell.getByRole('button', { name: '返回连接配置' }).click(); await closed;
    const refused = await setup.evaluate(async () => { const value = await window.gatewayConnections.snapshot(); return window.gatewayConnections.connect(value.epoch, value.profiles[0].id); });
    assert.equal(refused.ok, false); assert.equal(refused.error, 'SHELL_CLEANUP_RESTART_REQUIRED');
    assert.equal(app.windows().length, 1); report.checks.cleanupFailureBlocksNewActivation = true;
    report.passed = true;
  } else {
  const closed = shell.waitForEvent('close');
  await shell.getByRole('button', { name: '返回连接配置' }).click();
  await closed;
  const closedBy = Date.now() + 15_000;
  while (await fetch(shellOrigin + '/api/browser-session', { signal: AbortSignal.timeout(1000) }).then(() => true).catch(() => false)) {
    assert(Date.now() < closedBy, 'Shell cleanup deadline'); await delay(50);
  }
  const current = await setup.evaluate(() => window.gatewayConnections.snapshot());
  assert.equal(current.profiles[0].identity.gatewayId, discovery.payload.gatewayId);
  report.checks.workerCleanupAndIndependentRecovery = true;
  const reopened = await setup.evaluate(({ epoch, id }) => window.gatewayConnections.connect(epoch, id), { epoch: current.epoch, id: current.profiles[0].id });
  assert(reopened.ok);
  const crashWindow = app.windows().find(window => window !== setup);
  await crashWindow.getByText('身份与聊天传输契约已核验；S2 会话已建立。', { exact: true }).waitFor();
  const closedOnCrash = crashWindow.waitForEvent('close');
  await app.evaluate(({ app }) => {
    const metrics = app.getAppMetrics();
    const worker = metrics.find(value => value.type === 'Utility' && (value.name === 'xopc Desktop Shell' || value.serviceName === 'xopc Desktop Shell'));
    if (!worker) throw new Error('No owned Shell utility process: ' + JSON.stringify(metrics.map(m => ({ pid: m.pid, name: m.name, serviceName: m.serviceName, type: m.type }))));
    process.kill(worker.pid, 'SIGKILL');
  });
  await closedOnCrash;
  assert.equal(await setup.getByRole('heading', { name: 'Gateway 连接预览' }).isVisible(), true);
  report.checks.shellCrashKeepsIndependentRecovery = true;
  await stopGateway();
  const database = new DatabaseSync(join(gatewayState, 'xopc.db'));
  database.exec('DELETE FROM gateway_identity'); database.close();
  startGateway();
  const restartedBy = Date.now() + 30_000;
  while (!(await owner('/api/desktop-chat/bootstrap').then(r => r.ok).catch(() => false))) { assert(Date.now() < restartedBy, 'Gateway restart deadline'); await delay(100); }
  const changed = await (await owner('/api/desktop-chat/bootstrap')).json();
  assert.notEqual(changed.payload.gatewayId, discovery.payload.gatewayId);
  const locked = await setup.evaluate(async () => { const value = await window.gatewayConnections.snapshot(); return window.gatewayConnections.connect(value.epoch, value.profiles[0].id); });
  assert.equal(locked.ok, false); assert.match(locked.error, /GATEWAY_IDENTITY_(?:CHANGED|PROOF_FAILED)/);
  assert.equal(app.windows().length, 1);
  assert.equal((await setup.evaluate(() => window.gatewayConnections.snapshot())).profiles[0].identity.gatewayId, discovery.payload.gatewayId);
  report.checks.changedGatewayIdentityLockedWithoutFallback = true;
  report.passed = true;
  }
  }
} catch (error) {
  report.error = redact(error); report.gatewayLogTail = redact(gatewayLogs);
  report.windows = await Promise.all((app?.windows() ?? []).map(async page => ({ url: page.url(), body: (await page.locator('body').innerText({ timeout: 1000 }).catch(() => '')).slice(-1000) })));
  process.exitCode = 1;
} finally {
  if (app) await withTimeout(app.close(), 10_000, 'Electron close deadline').catch(() => app.process().kill('SIGKILL'));
  if (gateway?.exitCode === null) { const exit = once(gateway, 'exit'); gateway.kill('SIGTERM'); await withTimeout(exit, 10_000, 'Gateway stop').catch(() => gateway.kill('SIGKILL')); }
  if (tlsProxy) { for (const socket of proxySockets) socket.destroy(); await new Promise(resolve => tlsProxy.close(resolve)); }
  report.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  await cleanupLayout(); await rm(state, { recursive: true, force: true }); console.log(JSON.stringify(report));
}
