import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';

import { createAcceptanceOutput, localConnectionEnvironment, withTimeout } from './electron-local-connection-support.mjs';
import { installedAppFingerprint, killAcceptanceApplication, launchInstalledApplication, macPackagedTarget, packagedAcceptanceEnvironment, packagedGatewayEnvironment } from './electron-packaged-acceptance.mjs';

assert.equal(process.platform, 'darwin');
const index = process.argv.indexOf('--app'); assert(index >= 0);
const target = await macPackagedTarget(process.argv[index + 1]);
const output = await createAcceptanceOutput(join(process.cwd(), 'reports/p3-browser-native.json'));
const root = await mkdtemp(join(tmpdir(), 'xopc-native-browser-')), token = randomUUID();
const report = { passed: false, checks: {}, startedAt: new Date().toISOString(), scope: 'Installed Electron with real native Browser approvals, private process group, public HTTPS isolated counter, signed device HTTP/WSS and bundled Gateway/Agent; synthetic model with same-host Gateway. Not physical WAN Gateway or platform matrix acceptance.' };
let app, page, gateway, inference, inferenceError, proxy, relay, dropped, logs = '', dropNextResult = false;
const lostResultReview = process.argv.includes('--lost-result-review'), peers = new Set();
const manualArm = process.argv.includes('--manual-arm'); let armSequence = 0;
if (manualArm) console.log(`NATIVE BROWSER CONTROL FILE ${join(root, 'operator-arm.json')}`);
async function armNativeAction(action, recover) {
  if (!manualArm) return;
  const stage = `${++armSequence}:${recover ? 'recover' : 'run'}:${action}`;
  const expected = join(root, 'operator-expected.json'), control = join(root, 'operator-arm.json');
  await writeFile(expected, JSON.stringify({ stage })); console.log(`NATIVE BROWSER ARM ${stage} FILE ${expected}`);
  const until = performance.now() + 15000;
  while (performance.now() < until) {
    const permission = await readFile(control, 'utf8').then(text => JSON.parse(text)).catch(() => undefined);
    if (permission?.stage === stage) { await rm(control); return; }
    if (Array.isArray(permission?.stages) && permission.stages.includes(stage)) {
      await writeFile(control, JSON.stringify({ stages: permission.stages.filter(value => value !== stage) })); return;
    }
    await delay(50);
  }
  throw new Error('Synthetic operator coordination timed out before dispatch');
}
const redact = text => String(text).replaceAll(token, '[redacted-owner]').replace(/xopc_(?:at|rt|pair)_[A-Za-z0-9_-]+/g, '[redacted-device]');
async function until(probe, budget = 30000) {
  const deadline = Date.now() + budget;
  do { if (inferenceError) throw new Error(inferenceError); if (await probe()) return; await delay(100); } while (Date.now() < deadline);
  throw new Error('Browser acceptance deadline exceeded');
}
const fixtureIndex = process.argv.indexOf('--fixture-url'); assert(fixtureIndex >= 0);
const fixtureUrl = new URL(process.argv[fixtureIndex + 1]);
assert.equal(fixtureUrl.protocol, 'https:'); assert.equal(fixtureUrl.hostname, 'xl.xopc.io');
assert.match(fixtureUrl.pathname, /^\/__xopc_browser_[a-f0-9-]{36}\/$/);
const beforeCount = (await (await fetch(new URL('count', fixtureUrl))).json()).count;
assert.equal(beforeCount, 0, 'Use a fresh fixture; never reset a failed attempt count');
try {
  report.packageBefore = await installedAppFingerprint(target.application);
  inference = http.createServer(async (request, response) => {
    try {
      if (inferenceError) { response.writeHead(500).end('{}'); return; }
      const chunks = []; for await (const bytes of request) chunks.push(bytes);
      const body = JSON.parse(Buffer.concat(chunks)), messages = body.messages ?? [], names = (body.tools ?? []).map(tool => tool.function?.name);
      const last = messages.findLastIndex(message => message.role === 'user' && /BROWSER_CASE:(RUN|RECOVER)/.test(JSON.stringify(message.content)));
      const recover = last >= 0 && JSON.stringify(messages[last].content).includes('BROWSER_CASE:RECOVER'), turn = messages.slice(last + 1), toolNames = new Map();
      for (const message of turn) for (const call of message.tool_calls ?? []) toolNames.set(call.id, call.function?.name);
      const results = turn.filter(message => message.role === 'tool' && toolNames.get(message.tool_call_id) === 'browser_use');
      const actual = last >= 0 && (names.length > 0 || results.length > 0);
      report.requestShapes ??= []; if (report.requestShapes.length < 50) report.requestShapes.push({ hasCase: last >= 0, toolCount: names.length, browserResults: results.length, stream: body.stream === true });
      if (actual) report.lastBrowserToolTexts = results.slice(-3).map(result => (typeof result.content === 'string' ? result.content
        : Array.isArray(result.content) ? result.content.filter(part => part.type === 'text').map(part => part.text).join('\n') : '').slice(0, 4000));
      let tool;
      if (actual && (recover ? !report.checks.recoveredAfterReview : !(lostResultReview ? report.checks.agentUnknownReported : report.checks.agentBrowserAndClose))) {
        for (const [index, result] of results.entries()) {
          if (lostResultReview && !recover && dropped && index === 2) { assert(/unknown|UNKNOWN|DRIVER_UNAVAILABLE/.test(JSON.stringify(result.content)), 'Lost result must remain unknown'); continue; }
          assert(!/\[(?:DRIVER_UNAVAILABLE|ABORTED|INVALID_INPUT|STALE_OBSERVATION|BLOCKED_URL|TARGET_NOT_FOUND|EXPECTATION_FAILED)\]/.test(JSON.stringify(result.content)), 'Browser action failed: ' + JSON.stringify(result.content));
        }
        const complete = results.length >= (recover || lostResultReview ? 3 : 4);
        if (complete) {
          if (recover) report.checks.recoveredAfterReview = true;
          else if (lostResultReview) { assert(dropped, 'No real persisted completion was dropped'); report.checks.agentUnknownReported = true; }
          else report.checks.agentBrowserAndClose = true;
        }
        const name = names.find(name => name === 'browser_use');
        if (!complete && !name) { assert(!results.length && names.includes('tool_search'), 'Browser tool unavailable'); tool = { name: 'tool_search', arguments: JSON.stringify({ query: 'browser_use', limit: 5 }) }; }
        else if (!complete) {
          const latest = results.length ? (typeof results.at(-1).content === 'string' ? results.at(-1).content : JSON.stringify(results.at(-1).content)) : '';
          let args;
          if (!results.length) args = { action: 'navigate', url: fixtureUrl.href };
          else if (results.length === 1) args = { action: 'observe', visual: recover ? 'never' : 'always' };
          else if (recover && results.length === 2) args = { action: 'close' };
          else if (recover) report.checks.recoveredAfterReview = true;
          else if (results.length === 2) {
            const text = latest.replaceAll('\\n', '\n').replaceAll('\\"', '"');
            const revision = Number(text.match(/Revision: (\d+)/)?.[1]), ref = text.match(/- (e\d+) button "Increment fixture counter"/)?.[1];
            assert(revision > 0 && ref, 'Isolated Browser counter was not observed');
            args = { action: 'click', revision, ref, expect: { titleIncludes: 'XOPC Isolated Browser Counter' } };
            if (lostResultReview) dropNextResult = true;
          } else if (results.length === 3 && !lostResultReview) args = { action: 'close' };
          else if (lostResultReview) report.checks.agentUnknownReported = true;
          else report.checks.agentBrowserAndClose = true;
          if (args) { tool = { name, arguments: JSON.stringify(args) }; console.log('NATIVE BROWSER TOOL ' + args.action); }
        }
      }
      if (tool?.name === 'browser_use') await armNativeAction(JSON.parse(tool.arguments).action, recover);
      if (body.stream !== true) { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ id: 'fixture-' + randomUUID(), object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Fixture auxiliary response' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); return; }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('data: ' + JSON.stringify({ id: 'fixture-' + randomUUID(), object: 'chat.completion.chunk', choices: [{ index: 0,
        delta: { role: 'assistant', ...(tool ? { tool_calls: [{ index: 0, id: 'call-' + randomUUID(), type: 'function', function: tool }] } : { content: recover ? 'BROWSER_RECOVERY_OK' : actual ? lostResultReview ? 'BROWSER_RESULT_UNKNOWN_EXPECTED' : 'BROWSER_NATIVE_OK' : 'READY' }) }, finish_reason: tool ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    } catch (error) {
      inferenceError ??= String(error); report.inferenceFailure ??= { error: inferenceError, toolTexts: (() => {
        try { return (report.lastBrowserToolTexts ?? []).slice(-3); } catch { return []; }
      })() }; response.writeHead(500).end('{}');
    }
  }).listen(0, '127.0.0.1'); await once(inference, 'listening');
  const state = join(root, 'gateway'); await mkdir(state);
  await writeFile(join(state, 'models.json'), JSON.stringify({ providers: { 'browser-fixture': { baseUrl: `http://127.0.0.1:${inference.address().port}/v1`, apiKey: 'synthetic-fixture', api: 'openai-completions', models: [{ id: 'chat', name: 'Browser visual fixture', input: ['text', 'image'], reasoning: false, contextWindow: 128000, maxTokens: 2000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
  const probe = http.createServer().listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  let origin = `http://127.0.0.1:${port}`;
  if (lostResultReview) {
    proxy = http.createServer((request, response) => {
      const upstream = http.request({ host: '127.0.0.1', port, path: request.url, method: request.method, headers: request.headers }, value => { response.writeHead(value.statusCode, value.headers); value.pipe(response); });
      upstream.on('error', () => response.destroy()); request.pipe(upstream);
    }).listen(0, '127.0.0.1'); await once(proxy, 'listening');
    relay = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
    proxy.on('upgrade', (request, socket, head) => {
      const remote = new WebSocket(`ws://127.0.0.1:${port}${request.url}`, { ...(request.headers.origin ? { origin: request.headers.origin } : {}), followRedirects: false, maxPayload: 768 * 1024 });
      peers.add(remote); remote.once('close', () => peers.delete(remote)); remote.on('error', () => socket.destroy()); socket.once('error', () => remote.terminate());
      remote.once('open', () => relay.handleUpgrade(request, socket, head, local => {
        peers.add(local); local.once('close', () => { peers.delete(local); remote.terminate(); }); local.on('error', () => remote.terminate());
        local.on('message', bytes => {
          const message = JSON.parse(bytes.toString());
          if (dropNextResult && message.kind === 'desktop.endpoint.message' && message.payload?.message?.type === 'tool.result' && message.payload.message.payload.operationReceipt?.state === 'succeeded') {
            dropped = { operationId: message.payload.message.payload.operationReceipt.operationId }; dropNextResult = false;
            local.close(1011, 'Fixture drops persisted Browser completion'); remote.terminate(); return;
          }
          if (remote.readyState === WebSocket.OPEN) remote.send(bytes.toString());
        });
        remote.on('message', bytes => { if (local.readyState === WebSocket.OPEN) local.send(bytes.toString()); }); remote.once('close', () => local.terminate());
      }));
    });
    origin = `http://127.0.0.1:${proxy.address().port}`;
  }
  const config = join(state, 'xopc.json'); await writeFile(config, JSON.stringify({ gateway: { bind: 'loopback', port, corsOrigins: [origin], auth: { mode: 'token', token } }, browser: { enabled: true }, computer: { enabled: false } }));
  gateway = spawn(target.executablePath, [target.server, 'gateway', '--foreground', '--bind', 'loopback', '--port', String(port), '--no-hot-reload'], { cwd: root,
    env: packagedGatewayEnvironment(localConnectionEnvironment(process.env, process.cwd(), state, config, join(state, 'workspace')), target), stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [gateway.stdout, gateway.stderr]) stream.on('data', bytes => { logs = (logs + redact(bytes)).slice(-16000); });
  const owner = async (path, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    assert(response.ok, `Fixture request ${path}: ${response.status}`); const result = await response.json(); return result.payload ?? result;
  };
  await until(() => owner('/api/desktop-host/compatibility').then(value => value.capabilities.remoteBrowserVersion === 1).catch(() => false), 60000);
  const { defaults } = await owner('/api/global-defaults'); defaults.models.chat = { primary: 'browser-fixture/chat', fallbacks: [] }; await owner('/api/global-defaults', 'PATCH', { defaults, scope: 'models' });
  const agents = await owner('/api/agents'), agent = agents.agents.find(item => item.id === agents.defaultId) ?? agents.agents[0];
  await owner(`/api/agents/${agent.id}`, 'PATCH', { models: { chat: { primary: 'browser-fixture/chat', fallbacks: [] } }, runtime: { codemode: { enabled: true } } });
  const client = join(root, 'client'); await mkdir(client); const clientConfig = join(client, 'xopc.json'); await writeFile(clientConfig, '{invalid-local-config');
  app = await launchInstalledApplication(target, ['--gateway-connections'], { ...packagedAcceptanceEnvironment(localConnectionEnvironment(process.env, process.cwd(), client, clientConfig, join(client, 'workspace'))), XOPC_LOG_CONSOLE: 'true', XOPC_LOG_LEVEL: 'warn' }, root);
  report.runtime = app.metadata; page = await app.firstWindow();
  const saved = await page.evaluate(async ({ origin, token }) => { const api = window.gatewayConnections; let result = await api.save((await api.snapshot()).epoch, { name: 'Native Browser fixture', origin, transport: 'ssh', credential: token }); if (!result.ok) return result; const id = result.snapshot.profiles[0].id; result = await api.select(result.snapshot.epoch, id); return result.ok ? api.connect(result.snapshot.epoch, id) : result; }, { origin, token });
  assert(saved.ok, saved.error);
  const id = saved.snapshot.selectedId, chat = app.windows().find(window => window !== page); assert(chat);
  const snapshot = () => page.evaluate(() => window.gatewayConnections.snapshot());
  await chat.locator('#host-settings').click();
  const native = async (action, label) => {
    console.log(`NATIVE BROWSER ${label}; PID ${app.process().pid}`);
    await page.bringToFront();
    await until(async () => (await snapshot()).presentation.connectionFocused === true, 120000);
    return withTimeout(page.evaluate(async ({ action, id }) => { const api = window.gatewayConnections, state = await api.snapshot(); return action === 'enroll' ? api.enrollDesktop(state.epoch, id) : api.startBrowser(state.epoch, id); }, { action, id }), 120000, 'Native Browser grant deadline');
  };
  assert((await native('enroll', 'APPROVE device enrollment')).ok);
  const denied = await native('browser', 'CANCEL temporary Browser grant'); assert.equal(denied.error, 'DESKTOP_LOCAL_CONSENT_DENIED'); report.checks.nativeGrantCancelled = true;
  const grant = await native('browser', 'APPROVE temporary Browser grant'); assert(grant.ok, grant.error);
  report.grantState = grant.snapshot.execution;
  await until(async () => {
    const execution = (await snapshot()).execution;
    if (['stopped', 'error', 'stop-unconfirmed'].includes(execution?.state)) throw new Error('Browser Host stopped before online: ' + JSON.stringify(execution));
    return execution?.state === 'online';
  });
  console.log('NATIVE BROWSER approve only the isolated counter requests; all subsequent operations require native confirmation');
  await chat.bringToFront(); await chat.locator('#use-host').check(); await chat.locator('#input').fill('BROWSER_CASE:RUN'); await chat.locator('#send').click();
  await until(() => chat.locator('#messages').textContent().then(text => text.includes(lostResultReview ? 'BROWSER_RESULT_UNKNOWN_EXPECTED' : 'BROWSER_NATIVE_OK')), 120000);
  assert.equal((await (await fetch(new URL('count', fixtureUrl))).json()).count, beforeCount + 1); report.checks.actualBrowserSingleInput = true;
  if (lostResultReview) {
    assert(dropped, 'The fixture must drop a real signed durable success'); report.dropped = dropped;
    const state = () => { const db = new DatabaseSync(join(root, 'gateway/xopc.db'), { readOnly: true }); try { return db.prepare('SELECT state FROM capability_operations WHERE operation_id=?').get(dropped.operationId)?.state; } finally { db.close(); } };
    assert.equal(state(), 'unknown');
    await until(async () => { const execution = (await snapshot()).execution; return execution?.state === 'stopped' && execution.stopReceiptConfirmed === true; });
    const review = async label => {
      console.log(`NATIVE BROWSER ${label}; PID ${app.process().pid}`); await chat.locator('#host-settings').click(); await page.bringToFront();
      await until(async () => (await snapshot()).presentation.connectionFocused === true, 120000);
      return withTimeout(page.evaluate(async ({ id, operationId }) => { const api = window.gatewayConnections; return api.reviewOperation((await api.snapshot()).epoch, id, operationId); }, { id, ...dropped }), 120000, 'Native Browser unknown-result review');
    };
    const cancelled = await review('CANCEL unknown-result review'); assert.equal(cancelled.error, 'DESKTOP_LOCAL_CONSENT_DENIED'); assert.equal(state(), 'unknown');
    const reviewed = await review('APPROVE unknown-result review'); assert(reviewed.ok, reviewed.error); assert.equal(state(), 'unknown'); report.checks.unknownRetainedAfterReview = true;
    const next = await native('browser', 'APPROVE fresh Browser grant after review'); assert(next.ok, next.error);
    await until(async () => (await snapshot()).execution?.state === 'online');
    await chat.bringToFront(); await chat.locator('#use-host').check(); await chat.locator('#input').fill('BROWSER_CASE:RECOVER'); await chat.locator('#send').click();
    await until(() => chat.locator('#messages').textContent().then(text => text.includes('BROWSER_RECOVERY_OK')), 120000);
    assert.equal(state(), 'unknown'); assert.equal((await (await fetch(new URL('count', fixtureUrl))).json()).count, beforeCount + 1); report.checks.noReplayAfterRecovery = true;
  }
  const db = new DatabaseSync(join(state, 'xopc.db'), { readOnly: true });
  try {
    const rows = db.prepare("SELECT state,desktop_receipt_json FROM capability_operations WHERE desktop_intent_json LIKE '%desktop.browser.control%'").all();
    if (lostResultReview) {
      assert.equal(rows.length, 6); assert.equal(rows.filter(row => row.state === 'unknown').length, 1);
      assert(rows.filter(row => row.state !== 'unknown').every(row => row.state === 'succeeded' && JSON.parse(row.desktop_receipt_json).executionStopped));
    } else { assert.equal(rows.length, 4); assert(rows.every(row => row.state === 'succeeded' && JSON.parse(row.desktop_receipt_json).executionStopped)); }
    report.checks.durableNativeResults = true;
  } finally { db.close(); }
  assert((await page.evaluate(() => window.gatewayConnections.stopExecution())).ok);
  report.passed = true;
} catch (error) {
  report.error = redact(error?.stack ?? error); report.logs = logs;
  if (app) { report.applicationOutput = redact(app.output()); report.executionAtFailure = await page?.evaluate(async () => (await window.gatewayConnections.snapshot()).execution).catch(() => undefined); }
  process.exitCode = 1;
}
finally {
  if (app) { try { await withTimeout(app.close(), 10000, 'Browser application stop'); } catch { killAcceptanceApplication(app); } }
  inference?.closeAllConnections(); if (inference) await new Promise(resolve => inference.close(resolve));
  for (const peer of peers) peer.terminate(); relay?.close(); proxy?.closeAllConnections(); if (proxy) await new Promise(resolve => proxy.close(resolve));
  for (const child of [gateway]) if (child?.exitCode === null && child.signalCode === null) {
    try { const exit = once(child, 'exit'); child.kill('SIGTERM'); await withTimeout(exit, 10000, 'Private fixture stop'); }
    catch { child.kill('SIGKILL'); report.passed = false; report.cleanupFailed = true; process.exitCode = 1; }
  }
  report.packageAfter = await installedAppFingerprint(target.application); if (report.packageBefore?.sha256 !== report.packageAfter.sha256) { report.passed = false; process.exitCode = 1; }
  if (report.passed) await rm(root, { recursive: true, force: true }); else report.tempRoot = root;
  report.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
