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
const output = await createAcceptanceOutput(join(process.cwd(), 'reports/p3-computer-native.json'));
const root = await mkdtemp(join(tmpdir(), 'xopc-native-computer-')), token = randomUUID();
const report = { passed: false, checks: {}, startedAt: new Date().toISOString(), scope: 'Installed Electron with real native approvals, private Cua driver, isolated Cocoa counter, signed device HTTP/WSS and bundled Gateway/Agent; synthetic visual inference, same-host fixtures. Not physical WAN or platform matrix acceptance.' };
let app, page, gateway, inference, counter, inferenceError, proxy, relay, dropped, logs = '';
const lostResultReview = process.argv.includes('--lost-result-review'), cancelInput = process.argv.includes('--cancel-input'), peers = new Set(), actInvocations = new Set();
assert(!(lostResultReview && cancelInput), 'Run cancellation and result-loss cases separately');
const redact = text => String(text).replaceAll(token, '[redacted-owner]').replace(/xopc_(?:at|rt|pair)_[A-Za-z0-9_-]+/g, '[redacted-device]');
async function until(probe, budget = 30000) {
  const deadline = Date.now() + budget;
  do { if (inferenceError) throw new Error(inferenceError); if (await probe()) return; await delay(100); } while (Date.now() < deadline);
  throw new Error('Computer acceptance deadline exceeded');
}
function resultValue(value, depth = 0) {
  if (depth > 12 || value == null) return;
  if (typeof value === 'string') { let parsed; try { parsed = JSON.parse(value); } catch { return; } return resultValue(parsed, depth + 1); }
  if (typeof value !== 'object') return;
  if (value.errorCode) { if (cancelInput && value.status === 'program_error' && value.errorCode === 'COMPUTER_NATIVE_ACTION_FAILED') return value; throw new Error('Computer tool failed: ' + String(value.errorCode)); }
  if (Array.isArray(value.apps) || ['ready', 'stopped', 'program_completed', 'program_error'].includes(value.status)) return value;
  for (const child of Object.values(value)) { const result = resultValue(child, depth + 1); if (result) return result; }
}
const program = "const s=await ui.observe({}); const matches=s.elements.filter(e=>e.role==='AXButton'&&e.label==='Increment controlled counter'); if(matches.length!==1)throw new Error('Isolated counter target is ambiguous'); const r=await ui.act({snapshotId:s.snapshotId,action:{kind:'activate',ref:matches[0].ref}}); text({receipt:r.receipt});";
try {
  report.packageBefore = await installedAppFingerprint(target.application);
  const fixture = join(root, 'XopcCounter.app'), contents = join(fixture, 'Contents'), binary = join(contents, 'MacOS/Counter');
  await mkdir(join(contents, 'MacOS'), { recursive: true });
  await writeFile(join(contents, 'Info.plist'), '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>ai.xopc.computer-counter.acceptance</string><key>CFBundleExecutable</key><string>Counter</string><key>CFBundleName</key><string>XOPC Native Counter</string><key>CFBundlePackageType</key><string>APPL</string><key>NSHighResolutionCapable</key><true/></dict></plist>');
  execFileSync('clang++', ['-std=c++17', '-fobjc-arc', '-framework', 'Cocoa', join(process.cwd(), 'scripts/fixtures/computer-counter.mm'), '-o', binary], { timeout: 60000, stdio: 'pipe' });
  execFileSync('codesign', ['--force', '--sign', '-', fixture], { stdio: 'pipe' });
  const statePath = join(root, 'fixture-state.json');
  counter = spawn(binary, [statePath], { stdio: ['ignore', 'pipe', 'pipe'] });
  await until(() => readFile(statePath, 'utf8').then(text => JSON.parse(text).count === 0).catch(() => false));
  report.checks.isolatedNativeFixture = true;
  inference = http.createServer(async (request, response) => {
    try {
      if (inferenceError) { response.writeHead(500).end('{}'); return; }
      const chunks = []; for await (const bytes of request) chunks.push(bytes);
      const body = JSON.parse(Buffer.concat(chunks)), messages = body.messages ?? [], names = (body.tools ?? []).map(tool => tool.function?.name);
      const last = messages.findLastIndex(message => message.role === 'user' && /COMPUTER_CASE:(RUN|RECOVER)/.test(JSON.stringify(message.content)));
      const recover = last >= 0 && JSON.stringify(messages[last].content).includes('COMPUTER_CASE:RECOVER');
      const turn = messages.slice(last + 1), toolNames = new Map();
      for (const message of turn) for (const call of message.tool_calls ?? []) toolNames.set(call.id, call.function?.name);
      const results = turn.filter(message => message.role === 'tool' && toolNames.get(message.tool_call_id) === 'computer_use');
      const actual = last >= 0 && (names.length > 0 || results.length > 0);
      const lost = lostResultReview && !recover && dropped && results.length >= 3;
      const values = lost ? [] : results.map(value => resultValue(value)).filter(Boolean);
      let tool;
      if (actual && !(recover ? report.checks.recoveredAfterReview : lostResultReview ? report.checks.agentUnknownReported : report.checks.agentProgramAndClose)) {
        if (lost) report.checks.agentUnknownReported = true;
        else {
          const name = names.find(name => name === 'computer_use');
          const cancellation = cancelInput && values.some(value => value.status === 'program_error' && value.errorCode === 'COMPUTER_NATIVE_ACTION_FAILED');
          if (cancellation) report.checks.nativeInputRefusalReported = true;
          const released = cancellation || values.some(value => value.status === 'stopped');
          if (released) { if (recover) report.checks.recoveredAfterReview = true; else report.checks.agentProgramAndClose = true; }
          else if (!name) { assert(!results.length && names.includes('tool_search'), 'Computer tool unavailable'); tool = { name: 'tool_search', arguments: JSON.stringify({ query: 'computer_use', limit: 5 }) }; }
          else {
            const output = values.find(value => value.status === 'program_completed')?.output;
            if (output) report.fixtureProgramOutput = output;
            const apps = values.find(value => Array.isArray(value.apps))?.apps;
            assert(!values.some(value => value.status === 'program_error'), 'Native Computer program did not complete');
            const opened = values.some(value => value.status === 'ready' && !value.apps && value.sessionId);
            const completed = values.some(value => value.status === 'program_completed');
            const args = !apps ? { op: 'discover', query: 'XOPC Native Counter' }
              : !opened ? { op: 'open', appRef: apps.find(value => value.name === 'XOPC Native Counter')?.appRef ?? apps[0]?.appRef, mode: 'control', prepare: false, planner: 'agent' }
              : !completed ? { op: 'exec', code: recover ? 'const s=await ui.observe({}); text({observed:s.snapshotId});' : program, maxActions: 1, timeoutMs: 120000 }
              : { op: 'close' };
            if (args.op === 'open') assert(args.appRef, 'Isolated counter app was not discovered');
            tool = { name, arguments: JSON.stringify(args) }; console.log('NATIVE COMPUTER TOOL ' + args.op);
          }
        }
      }
      if (body.stream !== true) { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ id: 'fixture-' + randomUUID(), object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Fixture auxiliary response' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); return; }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('data: ' + JSON.stringify({ id: 'fixture-' + randomUUID(), object: 'chat.completion.chunk', choices: [{ index: 0,
        delta: { role: 'assistant', ...(tool ? { tool_calls: [{ index: 0, id: 'call-' + randomUUID(), type: 'function', function: tool }] } : { content: recover ? 'COMPUTER_RECOVERY_OK' : actual ? lostResultReview ? 'COMPUTER_RESULT_UNKNOWN_EXPECTED' : 'COMPUTER_NATIVE_OK' : 'READY' }) }, finish_reason: tool ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    } catch (error) { inferenceError = String(error); response.writeHead(500).end('{}'); }
  }).listen(0, '127.0.0.1'); await once(inference, 'listening');
  const state = join(root, 'gateway'); await mkdir(state);
  await writeFile(join(state, 'models.json'), JSON.stringify({ providers: { 'computer-fixture': { baseUrl: `http://127.0.0.1:${inference.address().port}/v1`, apiKey: 'synthetic-fixture', api: 'openai-completions', models: [{ id: 'chat', name: 'Counter visual fixture', input: ['text', 'image'], reasoning: false, contextWindow: 128000, maxTokens: 2000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
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
          if (message.kind === 'desktop.endpoint.message' && message.payload?.message?.type === 'tool.result' && message.payload.message.payload.operationReceipt?.state === 'succeeded' && actInvocations.has(message.payload.message.payload.invocationId) && !dropped) {
            dropped = { operationId: message.payload.message.payload.operationReceipt.operationId };
            local.close(1011, 'Fixture drops persisted Computer completion'); remote.terminate(); return;
          }
          if (remote.readyState === WebSocket.OPEN) remote.send(bytes.toString());
        });
        remote.on('message', bytes => { const message = JSON.parse(bytes.toString()); const invoke = message.payload; if (message.kind === 'endpoint.message' && invoke?.type === 'tool.invoke' && invoke.payload?.arguments?.op === 'act') actInvocations.add(invoke.payload.invocationId); if (local.readyState === WebSocket.OPEN) local.send(bytes.toString()); }); remote.once('close', () => local.terminate());
      }));
    });
    origin = `http://127.0.0.1:${proxy.address().port}`;
  }
  const config = join(state, 'xopc.json'); await writeFile(config, JSON.stringify({ gateway: { bind: 'loopback', port, corsOrigins: [origin], auth: { mode: 'token', token } }, browser: { enabled: false }, computer: { enabled: true } }));
  gateway = spawn(target.executablePath, [target.server, 'gateway', '--foreground', '--bind', 'loopback', '--port', String(port), '--no-hot-reload'], { cwd: root,
    env: packagedGatewayEnvironment(localConnectionEnvironment(process.env, process.cwd(), state, config, join(state, 'workspace')), target), stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [gateway.stdout, gateway.stderr]) stream.on('data', bytes => { logs = (logs + redact(bytes)).slice(-16000); });
  const owner = async (path, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    assert(response.ok, `Fixture request ${path}: ${response.status}`); const result = await response.json(); return result.payload ?? result;
  };
  await until(() => owner('/api/desktop-host/compatibility').then(value => value.capabilities.remoteComputerVersion === 1).catch(() => false), 60000);
  const { defaults } = await owner('/api/global-defaults'); defaults.models.chat = { primary: 'computer-fixture/chat', fallbacks: [] }; await owner('/api/global-defaults', 'PATCH', { defaults, scope: 'models' });
  const agents = await owner('/api/agents'), agent = agents.agents.find(item => item.id === agents.defaultId) ?? agents.agents[0];
  await owner(`/api/agents/${agent.id}`, 'PATCH', { models: { chat: { primary: 'computer-fixture/chat', fallbacks: [] } }, runtime: { codemode: { enabled: true } } });
  const client = join(root, 'client'); await mkdir(client); const clientConfig = join(client, 'xopc.json'); await writeFile(clientConfig, '{invalid-local-config');
  app = await launchInstalledApplication(target, ['--gateway-connections'], { ...packagedAcceptanceEnvironment(localConnectionEnvironment(process.env, process.cwd(), client, clientConfig, join(client, 'workspace'))), XOPC_LOG_CONSOLE: 'true', XOPC_LOG_LEVEL: 'warn' }, root);
  report.runtime = app.metadata; page = await app.firstWindow();
  const saved = await page.evaluate(async ({ origin, token }) => { const api = window.gatewayConnections; let result = await api.save((await api.snapshot()).epoch, { name: 'Native Computer fixture', origin, transport: 'ssh', credential: token }); if (!result.ok) return result; const id = result.snapshot.profiles[0].id; result = await api.select(result.snapshot.epoch, id); return result.ok ? api.connect(result.snapshot.epoch, id) : result; }, { origin, token });
  assert(saved.ok, saved.error);
  const id = saved.snapshot.selectedId, chat = app.windows().find(window => window !== page); assert(chat);
  const snapshot = () => page.evaluate(() => window.gatewayConnections.snapshot());
  await chat.locator('#host-settings').click();
  const native = async (action, label) => {
    console.log(`NATIVE COMPUTER ${label}; PID ${app.process().pid}`);
    await page.bringToFront();
    await until(async () => (await snapshot()).presentation.connectionFocused === true, 120000);
    return withTimeout(page.evaluate(async ({ action, id }) => { const api = window.gatewayConnections, state = await api.snapshot(); return action === 'enroll' ? api.enrollDesktop(state.epoch, id) : api.startComputer(state.epoch, id); }, { action, id }), 120000, 'Native Computer grant deadline');
  };
  assert((await native('enroll', 'APPROVE device enrollment')).ok);
  const denied = await native('computer', 'CANCEL temporary Computer grant'); assert.equal(denied.error, 'DESKTOP_LOCAL_CONSENT_DENIED'); report.checks.nativeGrantCancelled = true;
  const grant = await native('computer', 'APPROVE temporary Computer grant'); assert(grant.ok, grant.error);
  report.grantState = grant.snapshot.execution;
  await until(async () => {
    const execution = (await snapshot()).execution;
    if (['stopped', 'error', 'stop-unconfirmed'].includes(execution?.state)) throw new Error('Computer Host stopped before online: ' + JSON.stringify(execution));
    return execution?.state === 'online';
  });
  console.log('NATIVE COMPUTER approve only the isolated counter requests; all subsequent operations require native confirmation');
  await chat.bringToFront(); await chat.locator('#use-host').check(); await chat.locator('#input').fill('COMPUTER_CASE:RUN'); await chat.locator('#send').click();
  await until(() => chat.locator('#messages').textContent().then(text => text.includes(lostResultReview ? 'COMPUTER_RESULT_UNKNOWN_EXPECTED' : 'COMPUTER_NATIVE_OK')), 120000);
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).count, cancelInput ? 0 : 1);
  report.checks[cancelInput ? 'actualNativeInputCancelled' : 'actualNativeSingleInput'] = true;

  if (lostResultReview) {
    assert(dropped, 'The fixture must drop a real signed durable success'); report.dropped = dropped;
    const state = () => { const db = new DatabaseSync(join(root, 'gateway/xopc.db'), { readOnly: true }); try { return db.prepare('SELECT state FROM capability_operations WHERE operation_id=?').get(dropped.operationId)?.state; } finally { db.close(); } };
    assert.equal(state(), 'unknown');
    await until(async () => { const execution = (await snapshot()).execution; return execution?.state === 'stopped' && execution.stopReceiptConfirmed === true; });
    const review = async label => {
      console.log(`NATIVE COMPUTER ${label}; PID ${app.process().pid}`); await chat.locator('#host-settings').click(); await page.bringToFront();
      await until(async () => (await snapshot()).presentation.connectionFocused === true, 120000);
      return withTimeout(page.evaluate(async ({ id, operationId }) => { const api = window.gatewayConnections; return api.reviewOperation((await api.snapshot()).epoch, id, operationId); }, { id, ...dropped }), 120000, 'Native Computer unknown-result review');
    };
    const cancelled = await review('CANCEL unknown-result review'); assert.equal(cancelled.error, 'DESKTOP_LOCAL_CONSENT_DENIED'); assert.equal(state(), 'unknown');
    const reviewed = await review('APPROVE unknown-result review'); assert(reviewed.ok, reviewed.error); assert.equal(state(), 'unknown'); report.checks.unknownRetainedAfterReview = true;
    const next = await native('computer', 'APPROVE fresh Computer grant after review'); assert(next.ok, next.error);
    await until(async () => (await snapshot()).execution?.state === 'online');
    await chat.bringToFront(); await chat.locator('#use-host').check(); await chat.locator('#input').fill('COMPUTER_CASE:RECOVER'); await chat.locator('#send').click();
    await until(() => chat.locator('#messages').textContent().then(text => text.includes('COMPUTER_RECOVERY_OK')), 120000);
    assert.equal(state(), 'unknown'); assert.equal(JSON.parse(await readFile(statePath, 'utf8')).count, 1); report.checks.noReplayAfterRecovery = true;
  }
  const db = new DatabaseSync(join(state, 'xopc.db'), { readOnly: true });
  try {
    const rows = db.prepare("SELECT state,desktop_receipt_json FROM capability_operations WHERE desktop_intent_json LIKE '%desktop.computer.remote_control%'").all();
    assert.equal(rows.length, lostResultReview ? 8 : cancelInput ? 4 : 5);
    assert.equal(rows.filter(row => row.state === 'unknown').length, lostResultReview ? 1 : 0);
    assert(rows.filter(row => row.state !== 'unknown').every(row => row.state === 'succeeded' && JSON.parse(row.desktop_receipt_json).executionStopped)); report.checks.durableNativeResults = true;
  } finally { db.close(); }
  assert((await page.evaluate(() => window.gatewayConnections.stopExecution())).ok);
  report.passed = true;
} catch (error) {
  report.error = redact(error?.stack ?? error); report.logs = logs;
  if (app) { report.applicationOutput = redact(app.output()); report.executionAtFailure = await page?.evaluate(async () => (await window.gatewayConnections.snapshot()).execution).catch(() => undefined); }
  process.exitCode = 1;
}
finally {
  if (app) { try { await withTimeout(app.close(), 10000, 'Computer application stop'); } catch { killAcceptanceApplication(app); } }
  inference?.closeAllConnections(); if (inference) await new Promise(resolve => inference.close(resolve));
  for (const peer of peers) peer.terminate(); relay?.close(); proxy?.closeAllConnections(); if (proxy) await new Promise(resolve => proxy.close(resolve));
  for (const child of [gateway, counter]) if (child?.exitCode === null && child.signalCode === null) {
    try { const exit = once(child, 'exit'); child.kill('SIGTERM'); await withTimeout(exit, 10000, 'Private fixture stop'); }
    catch { child.kill('SIGKILL'); report.passed = false; report.cleanupFailed = true; process.exitCode = 1; }
  }
  report.packageAfter = await installedAppFingerprint(target.application); if (report.packageBefore?.sha256 !== report.packageAfter.sha256) { report.passed = false; process.exitCode = 1; }
  if (report.passed) await rm(root, { recursive: true, force: true }); else report.tempRoot = root;
  report.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
