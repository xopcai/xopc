import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { WebSocket, WebSocketServer } from 'ws';
import { _electron } from 'playwright-core';
import { createAcceptanceOutput, localConnectionEnvironment, prepareLocalConnectionLayout, withTimeout } from './electron-local-connection-support.mjs';
import { installedApplicationPids, installedAppFingerprint, killAcceptanceApplication, killInstalledShellWorker, launchInstalledApplication, macPackagedTarget, packagedAcceptanceEnvironment } from './electron-packaged-acceptance.mjs';
import { ContainerNetworkFixture, exerciseNetworkMatrix } from './electron-network-fixture.mjs';
import { exerciseRemoteEndurance, fixtureLifetimeSeconds, observeApplicationResources, remoteEnduranceOptions } from './electron-remote-endurance.mjs';

const root = resolve(import.meta.dirname, '..');
const endurance = remoteEnduranceOptions(process.argv.slice(2));
const background = process.argv.includes('--background');
const networkMatrix = process.argv.includes('--network-matrix');
const compatibilityMatrix = process.argv.includes('--compatibility-matrix');
const remoteFiles = process.argv.includes('--remote-files');
const output = await createAcceptanceOutput(join(root, 'reports/s3-remote-chat-e2e.json'));
const state = await mkdtemp(join(tmpdir(), 'xopc-s3-chat-'));
const appIndex = process.argv.indexOf('--app');
assert(appIndex < 0 || process.argv[appIndex + 1]?.endsWith('.app'), 'Missing --app path');
const packaged = appIndex < 0 ? undefined : await macPackagedTarget(process.argv[appIndex + 1]);
assert(packaged || endurance.connectionCycles < 100 && endurance.soakSeconds < 86400, 'Complete endurance acceptance requires an installed application');
const containerIndex = process.argv.indexOf('--gateway-container');
const containerImage = containerIndex < 0 ? undefined : process.argv[containerIndex + 1];
assert(!containerImage || packaged, 'Container acceptance requires an installed --app');
assert(!remoteFiles || packaged && !containerImage && !background, 'Native remote file acceptance requires a visible installed app and private process Gateway fixtures');
assert(!networkMatrix || containerImage && packaged, 'Network matrix requires an installed app and network-capable container image');
const cleanupLayout = packaged ? async () => {} : await prepareLocalConnectionLayout(root);
const tls = process.argv.includes('--tls');
const tlsRejection = process.argv.includes('--tls-rejection');
assert(!tlsRejection || tls && packaged, 'TLS rejection acceptance requires an installed app and TLS fixture');
const normalIndex = process.argv.indexOf('--normal-inputs');
const normalInputs = normalIndex < 0 ? 2 : Number(process.argv[normalIndex + 1]);
assert(Number.isInteger(normalInputs) && normalInputs >= 2 && normalInputs <= 100);
const intervalIndex = process.argv.indexOf('--input-interval-ms');
const inputIntervalMs = intervalIndex < 0 ? 0 : Number(process.argv[intervalIndex + 1]);
assert(Number.isInteger(inputIntervalMs) && inputIntervalMs >= 0 && inputIntervalMs <= 5000);
const report = { passed: false, tls, startedAt: new Date().toISOString(), checks: {}, scope: 'S3 development production Electron + two actual independent Gateways behind fault/TLS proxies, deterministic inference only; not installed app or physical WAN server' };
report.background = background;
report.fixtureLifetimeSeconds = fixtureLifetimeSeconds(endurance);
if (packaged) {
  report.scope = 'Installed macOS app and bundled Gateway runtime, isolated same-host server processes, deterministic inference; not independent physical server or public certificate acceptance';
  report.application = packaged.application;
  report.packageBefore = await installedAppFingerprint(packaged.application);
}
const environment = (...args) => { const env = localConnectionEnvironment(...args); return packaged ? packagedAcceptanceEnvironment(env) : env; };
const launch = (args, env) => packaged ? launchInstalledApplication(packaged, args, env, state, 30_000, { preserveBrowserDefaults: background }) : _electron.launch({ args, cwd: root, env, timeout: 30_000 });
const launchArgs = [...(packaged ? [] : [join(root, 'out/main/index.js')]), '--gateway-connections', ...(background ? ['--gateway-connections-background'] : [])];
const gateways = [], proxies = [], sockets = new Set();
const containers = [];
if (containerImage) {
  report.scope = 'Installed macOS app to two isolated Docker Gateways using the built bundled server and exact direct runtime dependencies; deterministic inference, same physical host, not standalone Docker release or WAN acceptance';
  report.containerImage = JSON.parse(execFileSync('docker', ['image', 'inspect', containerImage, '--format', '{{json .Id}}'], { encoding: 'utf8' }));
}
const faults = { offline: false, dropInput: false, hideReceipt: false, suppressFrames: false, injectGap: false, gaps: 0, posts: 0 };
let app, inference, serverLogs = '', tokenA;
const redact = text => String(text).replaceAll(tokenA ?? 'never-a-real-token', '[redacted]').replace(/Token: [^\n]+/g, 'Token: [redacted]');
const freePort = async () => { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; };
async function until(work, budget = 30_000) { const deadline = Date.now() + budget; while (Date.now() < deadline) { if (await work().catch(() => false)) return; await delay(100); } throw new Error('Condition deadline exceeded'); }
async function activate(page, id) {
  if (!background) return page.locator(`#${id}`).click();
  await until(() => page.locator(`#${id}`).isEnabled());
  try { await page.locator(`#${id}`).evaluate(node => { if (node.disabled) throw new Error('Acceptance action is disabled'); node.click(); }); }
  catch (error) { if (id !== 'recover' || !page.isClosed()) throw error; }
}
async function fillDraft(page, text) {
  if (!background) return page.locator('#input').fill(text);
  await page.locator('#input').evaluate((node, value) => {
    if (node.disabled) throw new Error('Acceptance input is disabled');
    node.value = value; node.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}
async function assertBackgroundWindows(page) {
  if (!background) return;
  if (packaged) {
    const snapshot = await app.windows()[0].evaluate(() => window.gatewayConnections.snapshot());
    assert.equal(snapshot.presentation.connectionVisible, false); assert.equal(snapshot.presentation.connectionFocused, false);
    assert.equal(snapshot.presentation.chat.visible, false); assert.equal(snapshot.presentation.chat.focused, false);
  }
  else assert(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible())));
}
async function gateway(name, faulted) {
  const directory = join(state, name); await mkdir(directory);
  const port = await freePort(), token = randomUUID(); if (faulted) tokenA = token;
  const forward = (req, res) => {
    if (faulted) faults.httpRequests = (faults.httpRequests ?? 0) + 1;
    if (faulted && faults.offline) { res.writeHead(503, { 'Content-Type': 'application/json' }).end('{}'); return; }
    if (faulted && faults.hideReceipt && req.url.includes('/input-receipts/')) { res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"ok":false,"error":{"code":"NOT_RECEIVED"}}'); return; }
    const input = req.method === 'POST' && /\/inputs$/.test(req.url);
    if (faulted && input) {
      faults.posts++;
      const hook = faults.onNextInput; faults.onNextInput = undefined;
      try { hook?.(); } catch (error) { req.destroy(error); res.destroy(error); return; }
    }
    if (faulted && faults.identityPort && req.headers.authorization) { faults.identityCredentialLeaks++; res.writeHead(403).end(); return; }
    const upstream = http.request({ host: '127.0.0.1', port: faulted && faults.identityPort ? faults.identityPort : port, path: req.url, method: req.method, headers: { ...req.headers, ...(faulted && faults.identityPort ? { origin: faults.identityOrigin } : {}) } }, response => {
      if (faulted && faults.incompatible && req.url.startsWith('/api/desktop-chat/bootstrap')) {
        const chunks = []; response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => { const data = JSON.parse(Buffer.concat(chunks).toString()); data.payload.manifest.realtimeProtocolVersion = 999; res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data)); }); return;
      }
      if (faulted && input && faults.dropInput) { faults.dropInput = false; response.resume(); response.once('end', () => res.destroy()); return; }
      if (faulted && req.method === 'PUT' && req.url.endsWith('/content')) {
        faults.fileWrites = (faults.fileWrites ?? 0) + 1;
        if (faults.dropFileReply && response.statusCode === 200) { faults.dropFileReply = false; response.resume(); response.once('end', () => res.destroy()); return; }
      }
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    }); upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
  };
  let proxy, restoreCertificate, untrustCertificate;
  if (tls && faulted) {
    const cert = join(directory, 'cert.pem'), key = join(directory, 'key.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', key, '-out', cert], { stdio: 'ignore' });
    const originalTls = { cert: await readFile(cert), key: await readFile(key) };
    proxy = https.createServer(originalTls, forward);
    const otherCert = join(directory, 'untrusted-cert.pem'), otherKey = join(directory, 'untrusted-key.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=untrusted-fixture', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', otherKey, '-out', otherCert], { stdio: 'ignore' });
    const untrustedTls = { cert: await readFile(otherCert), key: await readFile(otherKey) };
    restoreCertificate = () => proxy.setSecureContext(originalTls);
    untrustCertificate = () => proxy.setSecureContext(untrustedTls);
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
  await writeFile(config, JSON.stringify({ gateway: { mode: 'local', bind: containerImage ? 'lan' : 'loopback', port: containerImage ? 18790 : port, corsOrigins: [origin], auth: { mode: 'token', token } }, browser: { enabled: false } }));
  await writeFile(join(directory, 'models.json'), JSON.stringify({ providers: { 's3-fixture': { baseUrl: `http://${containerImage ? 'host.docker.internal' : '127.0.0.1'}:${inference.address().port}/v1`, apiKey: 'synthetic-fixture', api: 'openai-completions', models: [{ id: 'chat', name: 'S3 fixture', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 2000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
  const env = environment(process.env, root, directory, config, join(directory, 'workspace'));
  if (packaged) Object.assign(env, { ELECTRON_RUN_AS_NODE: '1',
    XOPC_SQLITE_ASSET_ROOT: join(packaged.resources, 'app.asar.unpacked/out/server'),
    XOPC_UI_STATIC_ROOT: join(packaged.resources, 'app.asar.unpacked/dist/gateway/static/root'),
    XOPC_TEMPLATE_PATH: join(packaged.resources, 'app.asar.unpacked/out/server/workspace-templates'),
    XOPC_BUNDLED_EXTENSIONS_ROOT: join(packaged.resources, 'app.asar.unpacked/dist/electron/extensions'),
    XOPC_BUNDLED_SKILLS_ROOT: join(packaged.resources, 'app.asar.unpacked/skills'),
  });
  let processHandle, networkFixture;
  if (containerImage) {
    const id = execFileSync('docker', ['create', ...(networkMatrix && faulted ? ['--cap-add', 'NET_ADMIN'] : []), '--entrypoint', 'sh', '-p', `127.0.0.1:${port}:18790`, containerImage, '-c', `sleep ${report.fixtureLifetimeSeconds}`], { encoding: 'utf8' }).trim(); containers.push(id);
    execFileSync('docker', ['cp', `${directory}/.`, `${id}:/home/node/.xopc`]);
    execFileSync('docker', ['start', id]);
    if (networkMatrix && faulted) { networkFixture = new ContainerNetworkFixture(id, containers); networkFixture.initialize(); }
    execFileSync('docker', ['exec', '--user', 'root', id, 'chown', '-R', 'node:node', '/home/node/.xopc']);
    assert.deepEqual(JSON.parse(execFileSync('docker', ['inspect', id, '--format', '{{json .Mounts}}'], { encoding: 'utf8' })), [], 'Container server must not share host state or workspace mounts');
    processHandle = spawn('docker', ['exec', id, 'node', 'out/server/index.js', 'gateway', '--foreground', '--bind', 'lan', '--port', '18790', '--no-hot-reload'], { stdio: ['ignore', 'pipe', 'pipe'] });
  } else processHandle = spawn(packaged?.executablePath ?? process.execPath, [packaged?.server ?? join(root, 'dist/src/cli/bin.js'), 'gateway', '--foreground', '--bind', 'loopback', '--port', String(port), '--no-hot-reload'], { cwd: packaged ? directory : root, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
  return { origin, port, token, api, networkFixture, restoreCertificate, untrustCertificate, health: async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(15000) });
    await response.arrayBuffer(); return { status: response.status };
  }, devicesBefore, devices: () => api('/api/endpoint-tools/devices'), certificate: tls && faulted ? join(directory, 'cert.pem') : undefined };
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
  }); inference.listen(0, containerImage ? '0.0.0.0' : '127.0.0.1'); await once(inference, 'listening');
  console.log('Preparing actual Gateway fixtures');
  const a = await gateway('gateway-a', true), b = await gateway('gateway-b', false);
  const client = join(state, 'client'); await mkdir(client); const config = join(client, 'xopc.json'); await writeFile(config, '{invalid-local-config');
  const env = environment(process.env, root, client, config, join(client, 'workspace'));
  if (a.certificate) env.NODE_EXTRA_CA_CERTS = a.certificate;
  app = await launch(launchArgs, env);
  if (packaged) {
    report.runtime = app.metadata; assert.equal(report.runtime.cwd, state);
  }
  let setup = await app.firstWindow(); setup.setDefaultTimeout(30_000); await setup.getByRole('heading', { name: 'Gateway 连接预览' }).waitFor();
  await assertBackgroundWindows(setup);
  async function save(target, name) {
    return setup.evaluate(async ({ target, name }) => { const snapshot = await window.gatewayConnections.snapshot(); const result = await window.gatewayConnections.save(snapshot.epoch, { name, origin: target.origin, transport: target.origin.startsWith('https:') ? 'direct' : 'ssh', credential: target.token }); if (!result.ok) throw new Error(result.error); return result.snapshot.profiles.find(profile => profile.name === name).id; }, { target: { origin: target.origin, token: target.token }, name });
  }
  const idA = await save(a, 'A'), idB = await save(b, 'B');
  const errors = [];
  async function open(id) {
    const result = await setup.evaluate(async id => { const snapshot = await window.gatewayConnections.snapshot(); return window.gatewayConnections.connect(snapshot.epoch, id); }, id);
    assert(result.ok, JSON.stringify(result)); const page = app.windows().find(page => page !== setup && page.url().startsWith('http:')); assert(page);
    page.on('pageerror', error => errors.push(String(error)));
    await assertBackgroundWindows(page);
    page.setDefaultTimeout(30_000); await until(() => page.locator('#status').textContent().then(value => ['就绪', '输入待核实'].includes(value)));
    return page;
  }
  if (tlsRejection) {
    const result = await setup.evaluate(async id => { const snapshot = await window.gatewayConnections.snapshot(); return window.gatewayConnections.connect(snapshot.epoch, id); }, idA);
    assert.equal(result.ok, false); assert.equal(result.error, 'GATEWAY_TLS_FAILED');
    assert.equal(faults.httpRequests ?? 0, 0, 'Untrusted certificate must fail before sending a credentialed HTTP request');
    assert.equal(app.windows().length, 1); assert.deepEqual(await a.devices(), a.devicesBefore);
    const files = await readdir(client); assert(!files.includes('xopc.db') && !files.includes('workspace'));
    report.checks.untrustedCertificateRejectedBeforeHttp = true;
    report.checks.noLocalGatewayHostOrWorkspace = true; report.passed = true;
  } else {
  console.log('Connecting remote chat');
  let page = await open(idA);
  async function send(text) { await fillDraft(page, text); await activate(page, 'send'); }
  console.log('Verifying initial text input');
  const firstStarted = Date.now();
  await send('first remote message');
  await page.locator('article[data-role="assistant"] p').getByText('REMOTE_CHAT_OK', { exact: true }).waitFor();
  await until(() => page.locator('#status').textContent().then(value => value === '就绪'));
  const normalSamples = [{ input: 1, durationMs: Date.now() - firstStarted }];
  const conversationA = await page.evaluate(async () => (await window.desktopShell.readState()).selected);
  if (remoteFiles) {
    const { space } = await a.api(`/api/files/contexts/session/${conversationA}`);
    const { resource } = await a.api(`/api/files/spaces/${space.id}/root`);
    const { absolutePath } = await a.api(`/api/files/${resource.id}/host-path`);
    const fixtureRoot = await realpath(absolutePath), privateRoot = await realpath(state);
    assert(fixtureRoot.startsWith(privateRoot + '/'), 'Only a private fixture workspace may be written');
    const name = `remote-snapshot-${randomUUID()}.txt`, path = join(fixtureRoot, name);
    await writeFile(path, 'snapshot original');
    console.log('NATIVE FILES focus the actual chat window, then use native upload prompts only');
    await page.bringToFront();
    await until(async () => (await setup.evaluate(() => window.gatewayConnections.snapshot())).presentation.chat.focused === true, 120000);
    await page.locator('#remote-files-open').click();
    const download = async () => {
      await page.locator('#remote-file-refresh').click();
      await page.locator('#remote-file-server').getByRole('button', { name: new RegExp(name) }).click();
      await until(() => page.locator('#remote-file-text').isEnabled());
    };
    const edit = async text => { await page.locator('#remote-file-text').fill(text); await page.locator('#remote-file-save').click(); await until(() => page.locator('#remote-file-upload').isEnabled()); };
    const upload = async (label, expected) => {
      console.log('NATIVE FILES ' + label);
      await page.locator('#remote-file-upload').click();
      await until(() => page.locator('#remote-file-status').textContent().then(text => text.includes(expected)), 120000);
    };
    await download(); assert.equal(await page.locator('#remote-file-text').inputValue(), 'snapshot original');
    await edit('snapshot changed'); await upload('CANCEL return; cached draft must remain', '已取消回传');
    assert.equal(await readFile(path, 'utf8'), 'snapshot original'); assert.equal(faults.fileWrites ?? 0, 0);
    await upload('APPROVE versioned return', '缓存副本已同步'); assert.equal(await readFile(path, 'utf8'), 'snapshot changed');
    await edit('conflicting draft'); await writeFile(path, 'external edit');
    await upload('APPROVE return with stale version; server must reject conflict', '服务器版本已变化'); assert.equal(await readFile(path, 'utf8'), 'external edit');
    await download(); await until(() => page.locator('#remote-file-text').inputValue().then(text => text === 'external edit'));
    await edit('applied before lost reply'); faults.dropFileReply = true;
    await upload('APPROVE return with lost response; no retry', '结果未知'); assert.equal(await readFile(path, 'utf8'), 'applied before lost reply');
    const writes = faults.fileWrites; assert(await page.locator('#remote-file-upload').isDisabled());
    const cached = await page.evaluate(() => window.desktopShell.fileAction('list')); assert(cached.ok); assert(cached.value.some(item => item.state === 'unknown'));
    const cacheRoot = join(client, 'electron/gateway-connections-v1/remote-file-snapshots');
    const cacheScopes = await readdir(cacheRoot); assert.equal(cacheScopes.length, 1);
    for (const file of await readdir(join(cacheRoot, cacheScopes[0]))) {
      const encrypted = await readFile(join(cacheRoot, cacheScopes[0], file));
      for (const text of ['snapshot original', 'conflicting draft', 'applied before lost reply', name]) assert(!encrypted.includes(Buffer.from(text)), 'Remote snapshot cache contains plaintext fixture data');
    }
    report.checks.remoteFileCacheEncrypted = true;
    assert.equal(faults.fileWrites, writes);
    await page.locator('#remote-files-close').click(); await until(() => page.locator('#remote-files').isHidden());
    report.checks.nativeRemoteFileSnapshotsConflictAndUnknown = true;
  }
  const secondStarted = Date.now();
  await send('second remote message');
  await until(() => page.locator('article[data-role="user"]').count().then(value => value === 2));
  await until(() => page.locator('#status').textContent().then(value => value === '就绪'));
  assert.equal(await page.locator('article[data-role="assistant"]').count(), 2);
  normalSamples.push({ input: 2, durationMs: Date.now() - secondStarted });
  report.normalInputs = normalInputs; report.normalSamples = normalSamples; report.inputIntervalMs = inputIntervalMs;
  for (let index = 2; index < normalInputs; index++) {
    if (inputIntervalMs) await delay(inputIntervalMs);
    const started = Date.now(), text = `normal-acceptance-${index + 1}`;
    await send(text);
    await until(async () => await page.locator('#status').textContent() === '就绪'
      && await page.locator('article[data-role="user"] p').last().innerText() === text);
    assert.equal(faults.posts, index + 1, 'Each normal input must issue exactly one POST');
    normalSamples.push({ input: index + 1, durationMs: Date.now() - started });
    report.completedNormalInputs = index + 1; await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  }
  report.normalInputs = normalInputs; report.normalSamples = normalSamples; report.inputIntervalMs = inputIntervalMs;
  if (normalInputs === 100) {
    assert(await page.locator('#older').isEnabled());
    await activate(page, 'older'); await until(() => page.locator('#latest').isVisible());
    assert(await page.locator('#send').isDisabled(), 'Historical page must not accept new inputs');
    await activate(page, 'latest'); await until(async () => !await page.locator('#input').isDisabled());
    report.checks.hundredNormalInputsAndHistoryPaging = true;
  }
  if (!background) await page.screenshot({ path: output.replace(/\.json$/, '.png') });
  report.checks.actualRemoteStartAppendHistory = true;
  console.log('Verifying server stop');
  const stopDeadline = Date.now() + 30_000;
  const stopRemaining = () => Math.max(1, stopDeadline - Date.now());
  // Rendered text can precede run completion. Do not cancel a previous input while the new POST is still being persisted.
  await until(async () => { const current = await a.api(`/api/sessions/${conversationA}/input-state`); return !current.activeRunId && current.control?.phase === 'idle'; }, stopRemaining());
  await until(() => page.locator('#stop').isDisabled(), stopRemaining());
  await send('SLOW_REMOTE'); await until(() => page.locator('#stop').isEnabled(), stopRemaining());
  const expectedStopRunId = (await a.api(`/api/sessions/${conversationA}/input-state`)).activeRunId;
  assert(expectedStopRunId, 'Slow invocation must be active before stopping');
  const abortRequest = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/agent/abort', { timeout: stopRemaining() });
  await activate(page, 'stop');
  const actualStopRunId = (await abortRequest).postDataJSON().runId;
  assert.equal(actualStopRunId, expectedStopRunId, 'Stop must target the slow invocation rather than an older run');
  await until(() => page.locator('#stop-state').textContent().then(value => value.includes('已确认')), stopRemaining());
  report.stopTarget = { expectedRunId: expectedStopRunId, actualRunId: actualStopRunId, passed: true };
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
  app = await launch(launchArgs, env);
  setup = await app.firstWindow(); setup.setDefaultTimeout(30_000); await setup.getByRole('heading', { name: 'Gateway 连接预览' }).waitFor();
  page = await open(idA);
  assert.equal((await page.evaluate(async () => (await window.desktopShell.readState()).pending)).clientMessageId, pending.clientMessageId);
  assert.equal(faults.posts, before + 1);
  if (packaged) killInstalledShellWorker(app);
  else await app.evaluate(({ app }) => { const child = app.getAppMetrics().find(metric => metric.type === 'Utility' && (metric.name === 'xopc Desktop Shell' || metric.serviceName === 'xopc Desktop Shell')); if (!child) throw new Error('Missing owned Shell worker'); process.kill(child.pid, 'SIGKILL'); });
  await until(() => Promise.resolve(page.isClosed())); page = await open(idA);
  assert.equal((await page.evaluate(async () => (await window.desktopShell.readState()).pending)).clientMessageId, pending.clientMessageId);
  assert.equal(faults.posts, before + 1);
  report.checks.processRestartAndWorkerCrashPreserveUnknownInput = true;
  const oldOrigin = new URL(page.url()).origin; await activate(page, 'recover'); await until(() => Promise.resolve(page.isClosed()));
  await until(() => fetch(oldOrigin + '/').then(() => false, () => true), 15_000);
  page = await open(idB); assert.equal(await page.locator('#input').inputValue(), ''); assert.equal(await page.locator('article').count(), 0);
  if (remoteFiles) {
    await page.bringToFront();
    await until(async () => (await setup.evaluate(() => window.gatewayConnections.snapshot())).presentation.chat.focused === true);
    const files = await page.evaluate(() => window.desktopShell.fileAction('list')); assert(files.ok, files.error); assert.deepEqual(files.value, []);
    report.checks.remoteFileGatewayNamespaceIsolated = true;
  }
  await fillDraft(page, 'private-B-draft'); await activate(page, 'recover'); await until(() => Promise.resolve(page.isClosed()));
  faults.hideReceipt = false; page = await open(idA);
  await until(() => page.locator('#status').textContent().then(value => value === '就绪'));
  assert.equal(faults.posts, before + 1); assert.equal(await page.evaluate(async () => (await window.desktopShell.readState()).pending), undefined);
  assert.equal(await page.locator('article[data-role="user"]').filter({ hasText: 'uncertain-once' }).count(), 1);
  await fillDraft(page, 'private-A-draft'); await activate(page, 'recover'); await until(() => Promise.resolve(page.isClosed()));
  page = await open(idB); assert.equal(await page.locator('#input').inputValue(), 'private-B-draft'); assert.equal(await page.locator('article').count(), 0);
  await activate(page, 'recover'); await until(() => Promise.resolve(page.isClosed()));
  page = await open(idA); assert.equal(await page.locator('#input').inputValue(), 'private-A-draft');
  assert.equal(await page.evaluate(async () => (await window.desktopShell.readState()).selected), conversationA);
  report.checks.lostReplyReceiptRecoveryAndGatewayDraftIsolation = true;
  const business = join(client, 'electron/gateway-connections-v1/chat-state');
  for (const name of await readdir(business)) { const bytes = await readFile(join(business, name)); for (const text of ['private-A-draft', 'private-B-draft', 'uncertain-once', tokenA]) assert(!bytes.includes(Buffer.from(text))); }
  assert.equal(await page.evaluate(() => window.electronAPI), undefined);
  const localFiles = await readdir(client); assert(!localFiles.includes('xopc.db')); assert(!localFiles.includes('workspace'));
  assert.deepEqual(await a.devices(), a.devicesBefore); assert.deepEqual(await b.devices(), b.devicesBefore);
  report.checks.encryptedHintsNoLocalGatewayDatabaseHostOrWorkspace = true;
  page = await exerciseRemoteEndurance({ options: endurance, report, page,
    open: target => open(target === 'A' ? idA : idB), posts: () => faults.posts,
    checkpoint: () => writeFile(output, JSON.stringify(report, null, 2) + '\n'),
    resources: () => observeApplicationResources(app.process().pid), until,
    close: async current => {
      const origin = new URL(current.url()).origin;
      await activate(current, 'recover'); await until(() => Promise.resolve(current.isClosed()), 15_000);
      await until(() => fetch(origin, { signal: AbortSignal.timeout(1000) }).then(() => false, () => true), 15_000);
    },
    checkBoundary: async (current, target, checkDraft) => {
      assert.equal(await current.locator('#status').textContent(), '就绪');
      assert.equal(await current.evaluate(() => window.electronAPI), undefined);
      assert.equal(await current.evaluate(() => fetch('/api/endpoint-tools/devices').then(response => response.status)), 403);
      const stored = await current.evaluate(() => window.desktopShell.readState()); assert.equal(stored.pending, undefined);
      if (target === 'A') assert.equal(stored.selected, conversationA);
      else assert.equal(await current.locator('article').count(), 0);
      if (checkDraft) assert.equal(await current.locator('#input').inputValue(), target === 'A' ? 'private-A-draft' : 'private-B-draft');
      const files = await readdir(client); assert(!files.includes('xopc.db') && !files.includes('workspace'));
      assert.deepEqual(await a.devices(), a.devicesBefore); assert.deepEqual(await b.devices(), b.devicesBefore);
    },
    send: async (current, text) => { await fillDraft(current, text); await activate(current, 'send'); },
    networkFault: async (current, kind) => {
      const before = faults.posts;
      if (kind === 'offline') {
        faults.offline = true; faults.injectGap = true; for (const socket of sockets) socket.destroy();
      } else faults.suppressFrames = true;
      try {
        await until(() => current.locator('#status').textContent().then(value => value.includes('重连') || value === '连接中'), 45_000);
        assert(await current.locator('#send').isDisabled());
        if (kind === 'offline') await delay(10_000);
      } finally { faults.offline = false; faults.suppressFrames = false; }
      await until(() => current.locator('#status').textContent().then(value => value === '就绪'), 30_000);
      assert.equal(faults.posts, before, 'Fault recovery resubmitted input');
    },
    restart: async () => {
      await app.close(); app = await launch(launchArgs, env); setup = await app.firstWindow();
      setup.setDefaultTimeout(30_000); await setup.getByRole('heading', { name: 'Gateway 连接预览' }).waitFor();
      return open(idA);
    },
  });
  if (networkMatrix) {
    const close = async current => {
      const origin = new URL(current.url()).origin;
      await activate(current, 'recover'); await until(() => Promise.resolve(current.isClosed()), 15_000);
      await until(() => fetch(origin, { signal: AbortSignal.timeout(1000) }).then(() => false, () => true), 15_000);
    };
    await close(page);
    await exerciseNetworkMatrix({ fixture: a.networkFixture, report, posts: () => faults.posts,
      checkpoint: () => writeFile(output, JSON.stringify(report, null, 2) + '\n'),
      newPage: async name => open(await save(a, `network-${name}`)), close,
      send: async (current, text) => { await fillDraft(current, text); await activate(current, 'send'); },
      settle: async current => {
        await until(() => current.locator('#status').textContent().then(value => ['就绪', '输入待核实'].includes(value)), 30_000);
        assert.equal(await current.evaluate(() => window.electronAPI), undefined);
        const files = await readdir(client); assert(!files.includes('xopc.db') && !files.includes('workspace'));
        assert.deepEqual(await a.devices(), a.devicesBefore);
        return { state: await current.locator('#status').textContent(), pending: Boolean((await current.evaluate(() => window.desktopShell.readState())).pending) };
      },
      health: a.health, onNextInput: hook => { faults.onNextInput = hook; },
      serverInputCount: async (current, text) => {
        const id = (await current.evaluate(() => window.desktopShell.readState())).selected;
        const data = await a.api(`/api/sessions/${id}/messages?limit=100`);
        const messages = data.messages ?? data;
        assert(Array.isArray(messages), 'Authoritative messages must be an array');
        return messages.filter(message => message.role === 'user' && JSON.stringify(message.content).includes(text)).length;
      },
    });
    page = await open(idA);
  }
  if (compatibilityMatrix) {
    const expectedState = { selected: (await page.evaluate(() => window.desktopShell.readState())).selected, draft: await page.locator('#input').inputValue() };
    await activate(page, 'recover'); await until(() => Promise.resolve(page.isClosed()));
    report.compatibilityMatrix = { cases: [], passed: false };
    const reject = async (id, expected) => {
      const started = performance.now(), before = faults.posts;
      const result = await setup.evaluate(async id => { const snapshot = await window.gatewayConnections.snapshot(); return window.gatewayConnections.connect(snapshot.epoch, id); }, id);
      assert.equal(result.ok, false); assert.equal(result.error, expected);
      assert(performance.now() - started < 15_000, 'Connection error exceeded original attempt budget');
      assert.equal(faults.posts, before, 'Rejected connection created an input');
      assert.equal(app.windows().length, 1, 'Rejected connection left a Shell window');
      report.compatibilityMatrix.cases.push({ expected, observed: result.error, durationMs: performance.now() - started });
    };
    await reject(await save({ ...a, token: randomUUID() }, 'invalid-credential'), 'GATEWAY_AUTH_FAILED');
    faults.incompatible = true;
    try { await reject(idA, 'GATEWAY_CHAT_INCOMPATIBLE'); } finally { faults.incompatible = false; }
    if (tls) {
      a.untrustCertificate();
      try { await reject(idA, 'GATEWAY_TLS_FAILED'); } finally { a.restoreCertificate(); }
    }
    faults.identityCredentialLeaks = 0; faults.identityPort = b.port; faults.identityOrigin = b.origin;
    try { await reject(idA, 'GATEWAY_IDENTITY_PROOF_FAILED'); } finally { faults.identityPort = undefined; }
    assert.equal(faults.identityCredentialLeaks, 0, 'Pinned identity replacement received an owner credential');
    report.compatibilityMatrix.identityCredentialLeaks = 0;
    page = await open(idA);
    assert.equal((await page.evaluate(() => window.desktopShell.readState())).selected, expectedState.selected);
    assert.equal(await page.locator('#input').inputValue(), expectedState.draft);
    assert.deepEqual(await a.devices(), a.devicesBefore); assert.deepEqual(await b.devices(), b.devicesBefore);
    report.compatibilityMatrix.passed = true;
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  }
  assert.deepEqual(errors, []);
  // Observe the requested clean relaunch and run precisely those arguments under the test supervisor.
  await activate(page, 'recover'); await until(() => Promise.resolve(page.isClosed())); page = await open(idB);
  console.log('Verifying explicit return to local');
  if (!packaged) {
  const relaunch = join(state, 'relaunch.json');
  await writeFile(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port: await freePort(), auth: { mode: 'token', token: randomUUID() } }, browser: { enabled: false } }));
  await app.evaluate(async ({ app }, path) => { const fs = process.getBuiltinModule('fs'); app.relaunch = options => fs.writeFileSync(path, JSON.stringify(options)); }, relaunch);
  await setup.evaluate(() => window.gatewayConnections.useLocal()).catch(() => {});
  await until(() => readFile(relaunch).then(() => true)); const args = JSON.parse(await readFile(relaunch, 'utf8')).args;
  assert.deepEqual(args, packaged ? [] : [join(root, 'out/main/index.js')]);
  await app.close().catch(() => {});
  app = await launch(args, env);
  const local = await app.firstWindow(); await until(() => local.evaluate(async () => Boolean(window.electronAPI) && (await fetch('/api/browser-session').then(async response => response.ok && typeof (await response.json()).conversationId === 'string'))), 30_000);
  report.checks.cleanLocalRelaunchWithOriginalMain = true;
  } else {
    const port = await freePort(), localToken = randomUUID();
    await writeFile(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port, auth: { mode: 'token', token: localToken } }, browser: { enabled: false } }));
    const executablePaths = [...new Set([packaged.executablePath, await realpath(packaged.executablePath)])];
    const pids = () => installedApplicationPids(execFileSync('ps', ['-axo', 'pid=,args='], { encoding: 'utf8' }), executablePaths);
    const beforePids = new Set(pids());
    await setup.evaluate(() => window.gatewayConnections.useLocal()).catch(() => {});
    try {
      await until(() => fetch(`http://127.0.0.1:${port}/api/config`, { headers: { Authorization: `Bearer ${localToken}` } }).then(response => response.ok), 30_000);
      const relaunched = pids().filter(pid => !beforePids.has(pid)); assert.equal(relaunched.length, 1);
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/config`)).status, 401);
      const html = await fetch(`http://127.0.0.1:${port}/`).then(response => response.text()); assert(html.includes('/assets/'));
      report.checks.actualPackagedLocalRelaunch = true;
    } finally {
      for (const pid of pids().filter(pid => !beforePids.has(pid))) killAcceptanceApplication({ process: () => ({ pid }) });
    }
  }
  report.passed = true;
  }
} catch (error) {
  report.error = redact(error?.stack ?? error); report.serverLogs = redact(serverLogs);
  if (packaged && app) report.applicationLogs = redact(app.output());
  if (app) report.windows = await Promise.all(app.windows().map(async page => ({ url: page.url(), text: await page.locator('body').innerText().catch(() => '') })));
  process.exitCode = 1;
} finally {
  const failures = [];
  const cleanup = async (phase, work) => { try { await work(); } catch (error) { failures.push({ phase, error: redact(error?.stack ?? error) }); report.passed = false; process.exitCode = 1; } };
  await cleanup('application', async () => {
    if (!app) return;
    try { await withTimeout(app.close(), 15_000, 'Electron stop'); }
    catch (error) { killAcceptanceApplication(app); throw error; }
  });
  await cleanup('package-integrity', async () => {
    if (!packaged) return;
    report.packageAfter = await installedAppFingerprint(packaged.application);
    assert.equal(report.packageAfter.sha256, report.packageBefore.sha256, 'Installed package mutated during acceptance');
  });
  for (const handle of gateways) await cleanup('gateway', async () => {
    if (handle.exitCode !== null || handle.signalCode !== null) return;
    const exit = once(handle, 'exit'); handle.kill('SIGTERM');
    try { await withTimeout(exit, 10_000, 'Gateway stop'); }
    catch (error) { handle.kill('SIGKILL'); throw error; }
  });
  if (!report.passed && containers.length) {
    const retained = join(state, 'failed-container-state'); await mkdir(retained, { recursive: true });
    report.retainedContainerState = { path: retained, scope: 'Raw state from stopped test containers; not a verified recovery backup', errors: [] };
    for (const id of containers) {
      try { execFileSync('docker', ['stop', '--time', '5', id], { stdio: 'ignore', timeout: 15_000 });
        execFileSync('docker', ['cp', `${id}:/home/node/.xopc`, join(retained, id)], { stdio: 'ignore', timeout: 15_000 });
      } catch (error) { report.retainedContainerState.errors.push(redact(error)); }
    }
  }
  for (const id of containers) await cleanup('container', () => execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore', timeout: 15_000 }));
  await cleanup('proxies', async () => { for (const socket of sockets) socket.destroy(); for (const proxy of proxies) await new Promise(resolve => proxy.close(resolve)); });
  await cleanup('inference', async () => { inference?.closeAllConnections(); if (inference) await new Promise(resolve => inference.close(resolve)); });
  await cleanup('layout', cleanupLayout);
  if (report.passed) await cleanup('state', () => rm(state, { recursive: true, force: true }));
  if (!report.passed) report.failureStateDirectory = state;
  report.cleanup = { confirmed: !failures.length, failures };
  report.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
