import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { connect as tcpConnect } from 'node:net';
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
const screen = process.argv.includes('--screen');
const observation = screen || process.argv.includes('--observation');
const observationTool = screen ? 'desktop.screen.capture' : 'desktop.device.get_state';
const observationScope = screen ? 'desktop.observe.screen' : 'desktop.observe.state';
const modelShapes = process.argv.includes('--model-shapes');
const output = await createAcceptanceOutput(join(root, 'reports/p2a2-native-enrollment.json'));
const state = await mkdtemp(join(tmpdir(), 'xopc-native-enrollment-')), token = randomUUID();
const report = { passed: false, startedAt: new Date().toISOString(), checks: {}, scope: 'Installed macOS application, actual OS safeStorage, native parented consent, independent bundled Gateway through SSH-loopback transport; no local tools or physical WAN claim', interactions: [] };
report.nativeCancelCovered = !approvalOnly;
if (observation) report.scope = 'Installed macOS runtime with OS safeStorage, native granular consent, independently authenticated state-only Host and explicit chat origin against a bundled Gateway; synthetic inference and same-host SSH-loopback, no screenshot/files/commands or physical WAN claim';
if (screen) report.scope = 'Installed macOS runtime, actual native source selection and per-capture consent, signed single-use image upload and actual Agent image projection; own chat window only, no display permission, input control or physical WAN claim';
let imageSeen = false;
let gateway, application, proxy, inference, logs = '', offline = false, inputPosts = 0, lastInputOrigin, stateReadSeen = false, inferenceError;
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
  if (observation) {
    inference = http.createServer(async (req, res) => {
      try {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString()), messages = body.messages ?? [], lastUser = messages.findLastIndex(message => message.role === 'user' && /Synthetic explicit desktop origin|Retained while desktop offline/.test(JSON.stringify(message.content)));
        const prompt = JSON.stringify(messages[lastUser]?.content ?? ''), results = messages.slice(lastUser + 1).filter(message => message.role === 'tool');
        const images = messages.flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'image_url' && /^data:image\//.test(part.image_url?.url ?? ''));
        if (screen && images.length) imageSeen = true;
        const names = (body.tools ?? []).map(tool => tool.function?.name);
        const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'd3-fixture', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'chat', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
        let tool;
        report.inferenceRequests ??= [];
        if (report.inferenceRequests.length < 40) report.inferenceRequests.push({ tools: names.slice(0, 24), toolResults: results.length, imageParts: images.map(part => ({ mimeType: part.image_url.url.slice(5).split(';')[0], encodedBytes: part.image_url.url.length })), explicitDesktopTurn: prompt.includes('Synthetic explicit desktop origin') });
        if (prompt.includes('Synthetic explicit desktop origin') && names.length) {
          if (!results.length) { assert(names.includes('tool_search'), 'Device tool discovery was not available'); tool = { name: 'tool_search', arguments: JSON.stringify({ query: screen ? 'desktop screenshot capture' : 'desktop device environment', limit: 5 }) }; }
          else if (screen ? !imageSeen && results.length < 2 : !JSON.stringify(results).includes('systemVersion')) {
            const name = names.find(name => name?.startsWith(screen ? 'device__desktop_screen_capture_' : 'device__desktop_device_get_state_'));
            assert(name, 'Discovery did not load the explicitly selected desktop state tool'); tool = { name, arguments: '{}' };
          } else if (!screen) { assert(JSON.stringify(results).includes('darwin')); stateReadSeen = true; }
        } else if (prompt.includes('Retained while desktop offline')) assert(!names.some(name => name?.startsWith('device__')), 'A stopped desktop tool remained declared for the server-only turn');
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(chunk({ role: 'assistant' }) + (tool ? chunk({ tool_calls: [{ index: 0, id: `d3-${randomUUID()}`, type: 'function', function: tool }] }) + chunk({}, 'tool_calls')
          : chunk({ content: 'OBSERVATION_CHAT_OK' }) + chunk({}, 'stop')) + 'data: [DONE]\n\n');
      } catch (error) { inferenceError = String(error); res.writeHead(500).end('{}'); }
    }).listen(0, '127.0.0.1'); await once(inference, 'listening');
    await writeFile(join(serverState, 'models.json'), JSON.stringify({ providers: { 'd3-fixture': { baseUrl: `http://127.0.0.1:${inference.address().port}/v1`, apiKey: 'synthetic-fixture', api: 'openai-completions', models: [{ id: 'chat', name: 'D3 fixture', input: screen ? ['text', 'image'] : ['text'], reasoning: false, contextWindow: 128000, maxTokens: 2000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
  }
  const serverPort = await port(), config = join(serverState, 'xopc.json');
  await writeFile(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port: serverPort, auth: { mode: 'token', token } }, browser: { enabled: false } }), { mode: 0o600 });
  const gatewayEnv = packagedGatewayEnvironment(localConnectionEnvironment(process.env, root, serverState, config, join(serverState, 'workspace')), target);
  if (modelShapes) Object.assign(gatewayEnv, { XOPC_LOG_LEVEL: 'debug', XOPC_LOG_CONSOLE: 'true', XOPC_LOG_LLM_PAYLOAD: 'true' });
  gateway = spawn(target.executablePath, [target.server, 'gateway', '--foreground', '--bind', 'loopback', '--port', String(serverPort), '--no-hot-reload'], {
    cwd: state, env: gatewayEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [gateway.stdout, gateway.stderr]) {
    let pending = '';
    stream.on('data', chunk => {
      if (!modelShapes) { logs = (logs + chunk).slice(-16000); return; }
      pending += String(chunk);
      if (pending.length > 4 * 1024 * 1024) { pending = ''; logs += '[Oversized diagnostic line omitted]\n'; return; }
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        try {
          const entry = JSON.parse(line);
          if (entry.effectiveContext) {
            report.modelShapes ??= [];
            report.modelShapes.push({ modelRef: entry.modelRef, messages: entry.effectiveContext.messages.map(message => ({ role: message.role, toolName: message.toolName,
              contentTypes: Array.isArray(message.content) ? message.content.map(block => block.type) : ['text'],
              imageDisabled: JSON.stringify(message.content).includes('Image reading is disabled.'), imageOmitted: JSON.stringify(message.content).includes('image omitted') })) });
            void writeFile(output + '.model-shapes.json', JSON.stringify(report.modelShapes, null, 2));
          }
          logs = (logs + JSON.stringify({ module: entry.module, msg: entry.msg, phase: entry.phase }) + '\n').slice(-16000);
        } catch { logs = (logs + '[Non-JSON diagnostic omitted]\n').slice(-16000); }
      }
    });
  }
  const owner = async (path, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${serverPort}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    assert(response.ok, `Owner fixture ${path}: ${response.status}`); const json = await response.json(); return json.payload ?? json;
  };
  await until(() => owner('/api/desktop-host/compatibility').then(() => true).catch(() => false), 60000);
  if (observation) {
    const { defaults } = await owner('/api/global-defaults'); defaults.models.chat = { primary: 'd3-fixture/chat', fallbacks: [] };
    await owner('/api/global-defaults', 'PATCH', { defaults, scope: 'models' });
    const catalog = await owner('/api/agents'), agent = catalog.agents.find(agent => agent.id === catalog.defaultId) ?? catalog.agents[0];
    await owner(`/api/agents/${agent.id}`, 'PATCH', { models: { chat: { primary: 'd3-fixture/chat', fallbacks: [] } }, runtime: { codemode: { enabled: true } } });
  }
  proxy = http.createServer((req, res) => {
    if (offline) { res.writeHead(503).end('{}'); return; }
    if (req.method === 'POST' && /\/inputs$/.test(req.url)) {
      inputPosts++; const chunks = []; req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => { lastInputOrigin = JSON.parse(Buffer.concat(chunks).toString()).origin; });
    }
    const upstream = http.request({ host: '127.0.0.1', port: serverPort, path: req.url, method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    upstream.on('error', () => res.destroy()); req.pipe(upstream);
  }).listen(0, '127.0.0.1'); await once(proxy, 'listening');
  proxy.on('upgrade', (request, socket, head) => {
    if (offline) { socket.destroy(); return; }
    const upstream = tcpConnect(serverPort, '127.0.0.1', () => {
      const headers = [];
      for (let index = 0; index < request.rawHeaders.length; index += 2) headers.push(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`);
      upstream.write([`${request.method} ${request.url} HTTP/${request.httpVersion}`, ...headers, '', ''].join('\r\n'));
      if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket);
    });
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
    socket.once('close', () => upstream.destroy()); upstream.once('close', () => socket.destroy());
  });
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
  if (process.argv.includes('--pause-before-save')) {
    console.log(`NATIVE PREPARATION PID ${application.process().pid}; focus the actual test window, then create ${output}.ready`);
    await until(() => readFile(output + '.ready', 'utf8').then(value => value.trim() === 'ready').catch(() => false), 120000);
  }
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
  if (observation) {
    const connected = await page.evaluate(async id => { const api = window.gatewayConnections, state = await api.snapshot(); return api.connect(state.epoch, id); }, id);
    assert(connected.ok, connected.error);
    const chat = application.windows().find(item => item !== page); assert(chat);
    await until(async () => await chat.locator('#status').textContent() === '就绪');
    await chat.locator('#host-settings').click(); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    if (!approvalOnly) {
      await native(screen ? 'observe-screen' : 'observe-state', 'cancel observation source');
      assert.equal((await owner('/api/endpoint-tools/devices')).filter(device => device.endpoints.length).length, 0);
      report.checks.cancelledObservationExposesNoEndpoint = true;
    }
    await native(screen ? 'observe-screen' : 'observe-state', screen ? 'choose current remote chat window' : 'approve state observation');
    await until(async () => (await snapshot()).observation?.state === 'online');
    assert.equal((await snapshot()).localCapabilities, true);
    const registered = (await owner('/api/endpoint-tools/devices')).find(device => device.id === firstId);
    assert.equal(registered.endpoints.length, 1); assert.deepEqual(registered.endpoints[0].tools.map(tool => tool.descriptor.name), [observationTool]);
    assert(registered.access.scopes.includes(observationScope));
    await chat.bringToFront();
    let hostOrigin;
    if (screen) {
      console.log('NATIVE PREPARATION focus the actual remote chat window; OS foreground is required before obtaining a screenshot origin');
      await until(async () => { hostOrigin = await chat.evaluate(() => window.desktopShell.hostOrigin()); return hostOrigin?.type === 'endpoint'; }, 120000);
    } else hostOrigin = await chat.evaluate(() => window.desktopShell.hostOrigin());
    assert.equal(hostOrigin.type, 'endpoint'); assert.equal(hostOrigin.endpointId, registered.endpoints[0].endpointId);
    const send = async text => { await chat.bringToFront(); await chat.locator('#use-host').check(); await chat.locator('#input').fill(text); await chat.locator('#send').click(); };
    if (screen && !approvalOnly) {
      await send('Synthetic explicit desktop origin cancel screenshot');
      console.log('NATIVE CONSENT cancel this screenshot; choose actual native Cancel');
      await until(async () => await chat.locator('#messages').textContent().then(value => value.includes('OBSERVATION_CHAT_OK')), 120000);
      assert(!imageSeen, 'Cancelled screenshot reached the model');
      const audit = await owner(`/api/endpoint-tools/invocations?principalId=${firstId}`);
      assert.equal(audit.items.filter(item => item.status === 'succeeded').length, 0);
      report.checks.perCaptureNativeCancelSendsNoImage = true;
    }
    const assistantsBefore = await chat.locator('#messages article[data-role="assistant"]').count();
    await send('Synthetic explicit desktop origin approve screenshot');
    if (screen) console.log('NATIVE CONSENT send this screenshot once; choose actual native Send');
    await until(async () => (screen ? imageSeen : stateReadSeen) && await chat.locator('#messages article[data-role="assistant"]').count() > assistantsBefore, 120000);
    assert(screen ? imageSeen : stateReadSeen, 'The model did not receive the actual Electron observation result');
    const audit = await owner(`/api/endpoint-tools/invocations?principalId=${firstId}`);
    assert.equal(audit.items.filter(item => item.status === 'succeeded').length, 1);
    report.checks[screen ? 'actualNativeCaptureSignedUploadAndAgentImage' : 'actualAgentDiscoveryAndSignedElectronStateInvocation'] = true;
    assert.equal(lastInputOrigin.endpointId, hostOrigin.endpointId); report.checks.explicitDesktopOriginAcceptedThroughShellAndGateway = true;
    await page.locator('#observation-stop').evaluate(button => button.click());
    await until(async () => (await snapshot()).observation?.state === 'stopped');
    await until(async () => (await snapshot()).observation?.serverRevocationConfirmed === true);
    assert.equal((await snapshot()).localCapabilities, false);
    await until(async () => !(await owner('/api/endpoint-tools/devices')).find(device => device.id === firstId).endpoints.length);
    const before = inputPosts; await chat.locator('#input').fill('Retained while desktop offline'); await chat.locator('#send').click();
    await until(async () => await chat.locator('#notice').textContent().then(value => value.includes('本机能力尚未连接')));
    assert.equal(inputPosts, before); assert.equal(await chat.locator('#input').inputValue(), 'Retained while desktop offline');
    await chat.locator('#use-host').uncheck(); await chat.locator('#send').click();
    await until(() => inputPosts > before && lastInputOrigin?.type === 'system');
    await until(async () => await chat.locator('#messages article[data-role="assistant"]').count() >= 2);
    report.checks.localStopRetainsDraftWithoutImplicitServerFallback = true;
    await chat.locator('#recover').click(); await until(() => Promise.resolve(chat.isClosed()));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  }
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
    assert.deepEqual(device.access.scopes, ['gateway.status', 'device.self']); assert.equal(device.endpoints.length, 0);
    if (!observation) assert.equal(device.principal, null);
  }
  report.checks[observation ? 'noWriteToolsAndOnlyExplicitObservationEndpoint' : 'noEndpointRegistrationOrLocalTools'] = true;
  await application.close(); application = undefined;
  report.packageAfter = await installedAppFingerprint(target.application); assert.deepEqual(report.packageAfter, report.packageBefore);
  report.passed = true;
} catch (error) { report.error = redact(error.stack ?? error); report.logs = redact(logs); report.applicationOutput = redact(error.installedApplicationOutput ?? application?.output() ?? ''); process.exitCode = 1; }
finally {
  if (application) { try { await application.close(); } catch { killAcceptanceApplication(application); } }
  proxy?.closeAllConnections(); if (proxy) await new Promise(resolve => proxy.close(resolve));
  inference?.closeAllConnections(); if (inference) await new Promise(resolve => inference.close(resolve));
  if (gateway?.exitCode === null) {
    try { const stopped = once(gateway, 'exit'); gateway.kill('SIGTERM'); await withTimeout(stopped, 10000, 'Enrollment fixture stop'); }
    catch { gateway.kill('SIGKILL'); report.cleanupFailure = true; report.passed = false; process.exitCode = 1; }
  }
  if (inferenceError) { report.inferenceError = redact(inferenceError); report.passed = false; process.exitCode = 1; }
  if (report.passed) await rm(state, { recursive: true, force: true }); else report.failureStateDirectory = state;
  report.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
