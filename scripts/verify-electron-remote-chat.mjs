import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { WebSocket, WebSocketServer } from 'ws';
import { _electron } from 'playwright-core';
import { createAcceptanceOutput, localConnectionEnvironment, prepareLocalConnectionLayout, withTimeout } from './electron-local-connection-support.mjs';

const root = resolve(import.meta.dirname, '..');
const output = await createAcceptanceOutput(join(root, 'reports/s3-remote-chat-e2e.json'));
const state = await mkdtemp(join(tmpdir(), 'xopc-s3-chat-'));
const cleanupLayout = await prepareLocalConnectionLayout(root);
const tls = process.argv.includes('--tls');
const report = { passed: false, tls, startedAt: new Date().toISOString(), checks: {}, scope: 'S3 development production Electron + two actual independent Gateways behind fault/TLS proxies, deterministic inference only; not installed app or physical WAN server' };
const gateways = [], proxies = [], sockets = new Set();
const faults = { offline: false, dropInput: false, hideReceipt: false, suppressFrames: false, injectGap: false, gaps: 0, posts: 0 };
let app, inference, serverLogs = '', tokenA;
const redact = text => String(text).replaceAll(tokenA ?? 'never-a-real-token', '[redacted]').replace(/Token: [^\n]+/g, 'Token: [redacted]');
const freePort = async () => { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; };
async function until(work, budget = 30_000) { const deadline = Date.now() + budget; while (Date.now() < deadline) { if (await work().catch(() => false)) return; await delay(100); } throw new Error('Condition deadline exceeded'); }
async function gateway(name, faulted) {
  const directory = join(state, name); await mkdir(directory);
  const port = await freePort(), token = randomUUID(); if (faulted) tokenA = token;
  const forward = (req, res) => {
    if (faulted && faults.offline) { res.writeHead(503, { 'Content-Type': 'application/json' }).end('{}'); return; }
    if (faulted && faults.hideReceipt && req.url.includes('/input-receipts/')) { res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"ok":false,"error":{"code":"NOT_RECEIVED"}}'); return; }
    const input = req.method === 'POST' && /\/inputs$/.test(req.url);
    if (faulted && input) faults.posts++;
    const upstream = http.request({ host: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers }, response => {
      if (faulted && input && faults.dropInput) { faults.dropInput = false; response.resume(); response.once('end', () => res.destroy()); return; }
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    }); upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
  };
  let proxy;
  if (tls && faulted) {
    const cert = join(directory, 'cert.pem'), key = join(directory, 'key.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', key, '-out', cert], { stdio: 'ignore' });
    proxy = https.createServer({ cert: await readFile(cert), key: await readFile(key) }, forward);
  } else proxy = http.createServer(forward);
  proxy.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  const wss = new WebSocketServer({ noServer: true });
  proxy.on('upgrade', (req, socket, head) => {
    if (faulted && faults.offline) { socket.destroy(); return; }
    const remote = new WebSocket(`ws://127.0.0.1:${port}${req.url}`, { origin });
    remote.on('error', () => socket.destroy()); socket.once('close', () => remote.terminate());
    remote.once('open', () => wss.handleUpgrade(req, socket, head, local => {
      local.on('message', data => { if (remote.readyState === WebSocket.OPEN) remote.send(data.toString()); });
      remote.on('message', data => {
        if (local.readyState !== WebSocket.OPEN || faulted && faults.suppressFrames) return;
        local.send(data.toString());
        if (faulted && faults.injectGap && JSON.parse(data.toString()).kind === 'realtime.ready') {
          faults.injectGap = false; faults.gaps++;
          local.send(JSON.stringify({ protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), kind: 'realtime.gap', payload: { topic: 'sessions', requestedSeq: 0, earliestSeq: 1, recoverable: false } }));
        }
      });
      local.on('error', () => remote.terminate()); local.once('close', () => remote.terminate()); remote.once('close', () => local.terminate());
    }));
  });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening'); proxies.push(proxy);
  const origin = `${tls && faulted ? 'https' : 'http'}://127.0.0.1:${proxy.address().port}`;
  const config = join(directory, 'xopc.json');
  await writeFile(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port, corsOrigins: [origin], auth: { mode: 'token', token } }, browser: { enabled: false } }));
  await writeFile(join(directory, 'models.json'), JSON.stringify({ providers: { 's3-fixture': { baseUrl: `http://127.0.0.1:${inference.address().port}/v1`, apiKey: 'synthetic-fixture', api: 'openai-completions', models: [{ id: 'chat', name: 'S3 fixture', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 2000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
  const env = localConnectionEnvironment(process.env, root, directory, config, join(directory, 'workspace'));
  const processHandle = spawn(process.execPath, [join(root, 'dist/src/cli/bin.js'), 'gateway', '--foreground', '--bind', 'loopback', '--port', String(port), '--no-hot-reload'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  gateways.push(processHandle); processHandle.stdout.on('data', chunk => { serverLogs = (serverLogs + chunk).slice(-16000); }); processHandle.stderr.on('data', chunk => { serverLogs = (serverLogs + chunk).slice(-16000); });
  await until(() => fetch(`http://127.0.0.1:${port}/api/desktop-chat/bootstrap?chat=1`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1500) }).then(response => response.ok), 60_000);
  const api = async (path, body, method = 'GET') => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    assert(response.ok, `Fixture setup ${path}: ${response.status}`); const data = await response.json(); return data.payload ?? data;
  };
  const { defaults } = await api('/api/global-defaults'); defaults.models.chat = { primary: 's3-fixture/chat', fallbacks: [] };
  await api('/api/global-defaults', { defaults, scope: 'models' }, 'PATCH');
  const catalog = await api('/api/agents'); const agent = catalog.agents.find(agent => agent.id === catalog.defaultId) ?? catalog.agents[0];
  await api(`/api/agents/${agent.id}`, { models: { chat: { primary: 's3-fixture/chat', fallbacks: [] } } }, 'PATCH');
  const devicesBefore = await api('/api/endpoint-tools/devices');
  return { origin, token, devicesBefore, devices: () => api('/api/endpoint-tools/devices'), certificate: tls && faulted ? join(directory, 'cert.pem') : undefined };
}
try {
  inference = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 's3-fixture', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'chat', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    const slow = JSON.stringify(JSON.parse(body).messages?.filter(message => message.role === 'user').at(-1)).includes('SLOW_REMOTE');
    send({ role: 'assistant' }); send({ content: slow ? 'REMOTE_PARTIAL' : 'REMOTE_CHAT_OK' });
    const finish = () => { send({}, 'stop'); res.end('data: [DONE]\n\n'); };
    if (slow) { const timer = setTimeout(finish, 30_000); res.once('close', () => clearTimeout(timer)); } else finish();
  }); inference.listen(0, '127.0.0.1'); await once(inference, 'listening');
  console.log('Preparing actual Gateway fixtures');
  const a = await gateway('gateway-a', true), b = await gateway('gateway-b', false);
  const client = join(state, 'client'); await mkdir(client); const config = join(client, 'xopc.json'); await writeFile(config, '{invalid-local-config');
  const env = localConnectionEnvironment(process.env, root, client, config, join(client, 'workspace'));
  if (a.certificate) env.NODE_EXTRA_CA_CERTS = a.certificate;
  app = await _electron.launch({ args: [join(root, 'out/main/index.js'), '--gateway-connections'], cwd: root, env, timeout: 30_000 });
  let setup = await app.firstWindow(); setup.setDefaultTimeout(30_000); await setup.getByRole('heading', { name: 'Gateway 连接预览' }).waitFor();
  async function save(target, name) {
    return setup.evaluate(async ({ target, name }) => { const snapshot = await window.gatewayConnections.snapshot(); const result = await window.gatewayConnections.save(snapshot.epoch, { name, origin: target.origin, transport: target.origin.startsWith('https:') ? 'direct' : 'ssh', credential: target.token }); if (!result.ok) throw new Error(result.error); return result.snapshot.profiles.find(profile => profile.name === name).id; }, { target: { origin: target.origin, token: target.token }, name });
  }
  const idA = await save(a, 'A'), idB = await save(b, 'B');
  async function open(id) {
    const result = await setup.evaluate(async id => { const snapshot = await window.gatewayConnections.snapshot(); return window.gatewayConnections.connect(snapshot.epoch, id); }, id);
    assert(result.ok, JSON.stringify(result)); const page = app.windows().find(page => page !== setup && page.url().startsWith('http:')); assert(page);
    page.setDefaultTimeout(30_000); await until(() => page.locator('#status').textContent().then(value => ['就绪', '输入待核实'].includes(value)));
    return page;
  }
  console.log('Connecting remote chat');
  let page = await open(idA);
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  async function send(text) { await page.locator('#input').fill(text); await page.locator('#send').click(); }
  console.log('Verifying initial text input');
  await send('first remote message');
  await page.locator('article[data-role="assistant"] p').getByText('REMOTE_CHAT_OK', { exact: true }).waitFor();
  await until(() => page.locator('#status').textContent().then(value => value === '就绪'));
  const conversationA = await page.evaluate(async () => (await window.desktopShell.readState()).selected);
  await send('second remote message');
  await until(() => page.locator('article[data-role="user"]').count().then(value => value === 2));
  await until(() => page.locator('#status').textContent().then(value => value === '就绪'));
  assert.equal(await page.locator('article[data-role="assistant"]').count(), 2);
  await page.screenshot({ path: output.replace(/\.json$/, '.png') });
  report.checks.actualRemoteStartAppendHistory = true;
  console.log('Verifying server stop');
  await send('SLOW_REMOTE'); await page.locator('#stop').waitFor(); await until(() => page.locator('#stop').isEnabled());
  await page.locator('#stop').click(); await until(() => page.locator('#stop-state').textContent().then(value => value.includes('已确认')));
  report.checks.serverStopVerified = true;
  console.log('Verifying network recovery');
  faults.offline = true; faults.injectGap = true; for (const socket of sockets) socket.destroy();
  await until(() => page.locator('#status').textContent().then(value => value.includes('重连') || value === '连接中'));
  assert(await page.locator('#send').isDisabled()); faults.offline = false;
  await until(() => page.locator('#status').textContent().then(value => value === '就绪'));
  assert.equal(faults.gaps, 1);
  report.checks.networkAndGapRecoveryWithoutResubmission = true;
  if (process.argv.includes('--half-open')) {
    const posts = faults.posts; faults.suppressFrames = true;
    await until(() => page.locator('#status').textContent().then(value => value.includes('重连') || value === '连接中'), 45_000);
    faults.suppressFrames = false;
    await until(() => page.locator('#status').textContent().then(value => value === '就绪'), 30_000);
    assert.equal(faults.posts, posts); report.checks.halfOpenRealtimeDetectedWithinOriginalBudget = true;
  }
  console.log('Verifying dropped reply and A/B isolation');
  const before = faults.posts; faults.dropInput = true; faults.hideReceipt = true;
  await send('uncertain-once'); await until(() => page.locator('#status').textContent().then(value => value === '输入待核实'));
  assert.equal(faults.posts, before + 1); assert(await page.locator('#send').isDisabled());
  const pending = await page.evaluate(async () => (await window.desktopShell.readState()).pending); assert(pending?.clientMessageId);
  console.log('Verifying pending input after process restart and worker crash');
  await app.close();
  app = await _electron.launch({ args: [join(root, 'out/main/index.js'), '--gateway-connections'], cwd: root, env, timeout: 30_000 });
  setup = await app.firstWindow(); setup.setDefaultTimeout(30_000); await setup.getByRole('heading', { name: 'Gateway 连接预览' }).waitFor();
  page = await open(idA);
  assert.equal((await page.evaluate(async () => (await window.desktopShell.readState()).pending)).clientMessageId, pending.clientMessageId);
  assert.equal(faults.posts, before + 1);
  await app.evaluate(({ app }) => { const child = app.getAppMetrics().find(metric => metric.type === 'Utility' && (metric.name === 'xopc Desktop Shell' || metric.serviceName === 'xopc Desktop Shell')); if (!child) throw new Error('Missing owned Shell worker'); process.kill(child.pid, 'SIGKILL'); });
  await until(() => Promise.resolve(page.isClosed())); page = await open(idA);
  assert.equal((await page.evaluate(async () => (await window.desktopShell.readState()).pending)).clientMessageId, pending.clientMessageId);
  assert.equal(faults.posts, before + 1);
  report.checks.processRestartAndWorkerCrashPreserveUnknownInput = true;
  const oldOrigin = new URL(page.url()).origin; await page.locator('#recover').click(); await until(() => Promise.resolve(page.isClosed()));
  await until(() => fetch(oldOrigin + '/').then(() => false, () => true), 15_000);
  page = await open(idB); assert.equal(await page.locator('#input').inputValue(), ''); assert.equal(await page.locator('article').count(), 0);
  await page.locator('#input').fill('private-B-draft'); await page.locator('#recover').click(); await until(() => Promise.resolve(page.isClosed()));
  faults.hideReceipt = false; page = await open(idA);
  await until(() => page.locator('#status').textContent().then(value => value === '就绪'));
  assert.equal(faults.posts, before + 1); assert.equal(await page.evaluate(async () => (await window.desktopShell.readState()).pending), undefined);
  assert.equal(await page.locator('article[data-role="user"]').filter({ hasText: 'uncertain-once' }).count(), 1);
  await page.locator('#input').fill('private-A-draft'); await page.locator('#recover').click(); await until(() => Promise.resolve(page.isClosed()));
  page = await open(idB); assert.equal(await page.locator('#input').inputValue(), 'private-B-draft'); assert.equal(await page.locator('article').count(), 0);
  await page.locator('#recover').click(); await until(() => Promise.resolve(page.isClosed()));
  page = await open(idA); assert.equal(await page.locator('#input').inputValue(), 'private-A-draft');
  assert.equal(await page.evaluate(async () => (await window.desktopShell.readState()).selected), conversationA);
  report.checks.lostReplyReceiptRecoveryAndGatewayDraftIsolation = true;
  const business = join(client, 'electron/gateway-connections-v1/chat-state');
  for (const name of await readdir(business)) { const bytes = await readFile(join(business, name)); for (const text of ['private-A-draft', 'private-B-draft', 'uncertain-once', tokenA]) assert(!bytes.includes(Buffer.from(text))); }
  assert.equal(await page.evaluate(() => window.electronAPI), undefined);
  const localFiles = await readdir(client); assert(!localFiles.includes('xopc.db')); assert(!localFiles.includes('workspace'));
  assert.deepEqual(await a.devices(), a.devicesBefore); assert.deepEqual(await b.devices(), b.devicesBefore);
  report.checks.encryptedHintsNoLocalGatewayDatabaseHostOrWorkspace = true;
  assert.deepEqual(errors, []);
  // Observe the requested clean relaunch and run precisely those arguments under the test supervisor.
  await page.locator('#recover').click(); await until(() => Promise.resolve(page.isClosed())); page = await open(idB);
  console.log('Verifying explicit return to local');
  const relaunch = join(state, 'relaunch.json');
  await writeFile(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port: await freePort(), auth: { mode: 'token', token: randomUUID() } }, browser: { enabled: false } }));
  await app.evaluate(async ({ app }, path) => { const fs = process.getBuiltinModule('fs'); app.relaunch = options => fs.writeFileSync(path, JSON.stringify(options)); }, relaunch);
  await setup.evaluate(() => window.gatewayConnections.useLocal()).catch(() => {});
  await until(() => readFile(relaunch).then(() => true)); const args = JSON.parse(await readFile(relaunch, 'utf8')).args;
  assert.deepEqual(args, [join(root, 'out/main/index.js')]);
  await app.close().catch(() => {});
  app = await _electron.launch({ args, cwd: root, env, timeout: 30_000 });
  const local = await app.firstWindow(); await until(() => local.evaluate(async () => Boolean(window.electronAPI) && (await fetch('/api/browser-session').then(async response => response.ok && typeof (await response.json()).conversationId === 'string'))), 30_000);
  report.checks.cleanLocalRelaunchWithOriginalMain = true;
  report.passed = true;
} catch (error) {
  report.error = redact(error?.stack ?? error); report.serverLogs = redact(serverLogs);
  if (app) report.windows = await Promise.all(app.windows().map(async page => ({ url: page.url(), text: await page.locator('body').innerText().catch(() => '') })));
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  if (app) await withTimeout(app.close(), 10_000, 'Electron stop').catch(() => app.process().kill('SIGKILL'));
  for (const handle of gateways) if (handle.exitCode === null) { const exit = once(handle, 'exit'); handle.kill('SIGTERM'); await withTimeout(exit, 10_000, 'Gateway stop').catch(() => handle.kill('SIGKILL')); }
  for (const socket of sockets) socket.destroy(); for (const proxy of proxies) await new Promise(resolve => proxy.close(resolve));
  inference?.closeAllConnections(); if (inference) await new Promise(resolve => inference.close(resolve));
  await cleanupLayout(); await rm(state, { recursive: true, force: true }); console.log(JSON.stringify(report));
}
