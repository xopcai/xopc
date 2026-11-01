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

import { createAcceptanceOutput, localConnectionEnvironment, withTimeout } from './electron-local-connection-support.mjs';
import { installedAppFingerprint, killAcceptanceApplication, launchInstalledApplication, macPackagedTarget, packagedAcceptanceEnvironment, packagedGatewayEnvironment } from './electron-packaged-acceptance.mjs';

assert.equal(process.platform, 'darwin');
const index = process.argv.indexOf('--app'); assert(index >= 0);
const target = await macPackagedTarget(process.argv[index + 1]);
const output = await createAcceptanceOutput(join(process.cwd(), 'reports/p3-computer-native.json'));
const root = await mkdtemp(join(tmpdir(), 'xopc-native-computer-')), token = randomUUID();
const report = { passed: false, checks: {}, startedAt: new Date().toISOString(), scope: 'Installed Electron with real native approvals, private Cua driver, isolated Cocoa counter, signed device HTTP/WSS and bundled Gateway/Agent; synthetic visual inference, same-host fixtures. Not physical WAN or platform matrix acceptance.' };
let app, page, gateway, inference, counter, inferenceError, logs = '';
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
  if (value.errorCode) throw new Error('Computer tool failed: ' + String(value.errorCode));
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
      const last = messages.findLastIndex(message => message.role === 'user' && JSON.stringify(message.content).includes('COMPUTER_CASE:RUN'));
      const actual = last >= 0, results = messages.slice(last + 1).filter(message => message.role === 'tool'), values = results.map(value => resultValue(value)).filter(Boolean);
      let tool;
      if (actual && !report.checks.agentProgramAndClose) {
        const name = names.find(name => name === 'computer_use');
        if (!name) { assert(!results.length && names.includes('tool_search'), 'Computer tool unavailable'); tool = { name: 'tool_search', arguments: JSON.stringify({ query: 'computer_use', limit: 5 }) }; }
        else {
          const output = values.find(value => value.status === 'program_completed')?.output;
          if (output) report.fixtureProgramOutput = output;
          const apps = values.find(value => Array.isArray(value.apps))?.apps;
          assert(!values.some(value => value.status === 'program_error'), 'Native Computer program did not complete');
          const opened = values.some(value => value.status === 'ready' && !value.apps && value.sessionId);
          const completed = values.some(value => value.status === 'program_completed'), released = values.some(value => value.status === 'stopped');
          const args = !apps ? { op: 'discover', query: 'XOPC Native Counter' }
            : !opened ? { op: 'open', appRef: apps.find(value => value.name === 'XOPC Native Counter')?.appRef ?? apps[0]?.appRef, mode: 'control', prepare: false, planner: 'agent' }
            : !completed ? { op: 'exec', code: program, maxActions: 1, timeoutMs: 120000 }
            : !released ? { op: 'close' } : undefined;
          if (args) { if (args.op === 'open') assert(args.appRef, 'Isolated counter app was not discovered'); tool = { name, arguments: JSON.stringify(args) }; console.log('NATIVE COMPUTER TOOL ' + args.op); }
          else report.checks.agentProgramAndClose = true;
        }
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('data: ' + JSON.stringify({ id: 'fixture-' + randomUUID(), object: 'chat.completion.chunk', choices: [{ index: 0,
        delta: { role: 'assistant', ...(tool ? { tool_calls: [{ index: 0, id: 'call-' + randomUUID(), type: 'function', function: tool }] } : { content: actual ? 'COMPUTER_NATIVE_OK' : 'READY' }) }, finish_reason: tool ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    } catch (error) { inferenceError = String(error); response.writeHead(500).end('{}'); }
  }).listen(0, '127.0.0.1'); await once(inference, 'listening');
  const state = join(root, 'gateway'); await mkdir(state);
  await writeFile(join(state, 'models.json'), JSON.stringify({ providers: { 'computer-fixture': { baseUrl: `http://127.0.0.1:${inference.address().port}/v1`, apiKey: 'synthetic-fixture', api: 'openai-completions', models: [{ id: 'chat', name: 'Counter visual fixture', input: ['text', 'image'], reasoning: false, contextWindow: 128000, maxTokens: 2000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
  const probe = http.createServer().listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const config = join(state, 'xopc.json'); await writeFile(config, JSON.stringify({ gateway: { bind: 'loopback', port, auth: { mode: 'token', token } }, browser: { enabled: false }, computer: { enabled: true } }));
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
  const saved = await page.evaluate(async ({ origin, token }) => { const api = window.gatewayConnections; let result = await api.save((await api.snapshot()).epoch, { name: 'Native Computer fixture', origin, transport: 'ssh', credential: token }); if (!result.ok) return result; const id = result.snapshot.profiles[0].id; result = await api.select(result.snapshot.epoch, id); return result.ok ? api.connect(result.snapshot.epoch, id) : result; }, { origin: `http://127.0.0.1:${port}`, token });
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
  await until(() => chat.locator('#messages').textContent().then(text => text.includes('COMPUTER_NATIVE_OK')), 120000);
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).count, 1); report.checks.actualNativeSingleInput = true;
  const db = new DatabaseSync(join(state, 'xopc.db'), { readOnly: true });
  try {
    const rows = db.prepare("SELECT state,desktop_receipt_json FROM capability_operations WHERE desktop_intent_json LIKE '%desktop.computer.remote_control%'").all();
    assert(rows.length >= 5); assert(rows.every(row => row.state === 'succeeded' && JSON.parse(row.desktop_receipt_json).executionStopped)); report.checks.durableNativeResults = true;
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
  for (const child of [gateway, counter]) if (child?.exitCode === null && child.signalCode === null) {
    try { const exit = once(child, 'exit'); child.kill('SIGTERM'); await withTimeout(exit, 10000, 'Private fixture stop'); }
    catch { child.kill('SIGKILL'); report.passed = false; report.cleanupFailed = true; process.exitCode = 1; }
  }
  report.packageAfter = await installedAppFingerprint(target.application); if (report.packageBefore?.sha256 !== report.packageAfter.sha256) { report.passed = false; process.exitCode = 1; }
  if (report.passed) await rm(root, { recursive: true, force: true }); else report.tempRoot = root;
  report.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
