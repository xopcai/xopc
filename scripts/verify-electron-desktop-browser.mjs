import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
const output = await createAcceptanceOutput(join(process.cwd(), 'reports/p3-browser-native.json'));
const root = await mkdtemp(join(tmpdir(), 'xopc-native-browser-')), token = randomUUID();
const report = { passed: false, checks: {}, startedAt: new Date().toISOString(), scope: 'Installed Electron with real native Browser approvals, private process group, public HTTPS isolated counter, signed device HTTP/WSS and bundled Gateway/Agent; synthetic model with same-host Gateway. Not physical WAN Gateway or platform matrix acceptance.' };
let app, page, gateway, inference, inferenceError, logs = '';
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
      const last = messages.findLastIndex(message => message.role === 'user' && JSON.stringify(message.content).includes('BROWSER_CASE:RUN'));
      const actual = last >= 0, turn = messages.slice(last + 1), toolNames = new Map();
      for (const message of turn) for (const call of message.tool_calls ?? []) toolNames.set(call.id, call.function?.name);
      const results = turn.filter(message => message.role === 'tool' && toolNames.get(message.tool_call_id) === 'browser_use');
      let tool;
      if (actual && !report.checks.agentBrowserAndClose) {
        const name = names.find(name => name === 'browser_use');
        if (!name) { assert(!results.length && names.includes('tool_search'), 'Browser tool unavailable'); tool = { name: 'tool_search', arguments: JSON.stringify({ query: 'browser_use', limit: 5 }) }; }
        else {
          for (const result of results) assert(!/\[(?:DRIVER_UNAVAILABLE|ABORTED|INVALID_INPUT|STALE_OBSERVATION|BLOCKED_URL|TARGET_NOT_FOUND|EXPECTATION_FAILED)\]/.test(JSON.stringify(result.content)), 'Browser action failed: ' + JSON.stringify(result.content));
          const latest = results.length ? (typeof results.at(-1).content === 'string' ? results.at(-1).content : JSON.stringify(results.at(-1).content)) : '';
          let args;
          if (!results.length) args = { action: 'navigate', url: fixtureUrl.href };
          else if (results.length === 1) args = { action: 'observe', visual: 'always' };
          else if (results.length === 2) {
            const text = latest.replaceAll('\\n', '\n').replaceAll('\\"', '"');
            const revision = Number(text.match(/Revision: (\d+)/)?.[1]), ref = text.match(/- (e\d+) button "Increment fixture counter"/)?.[1];
            assert(revision > 0 && ref, 'Isolated Browser counter was not observed');
            args = { action: 'click', revision, ref, expect: { titleIncludes: 'XOPC Isolated Browser Counter' } };
          } else if (results.length === 3) args = { action: 'close' };
          else report.checks.agentBrowserAndClose = true;
          if (args) { tool = { name, arguments: JSON.stringify(args) }; console.log('NATIVE BROWSER TOOL ' + args.action); }
        }
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('data: ' + JSON.stringify({ id: 'fixture-' + randomUUID(), object: 'chat.completion.chunk', choices: [{ index: 0,
        delta: { role: 'assistant', ...(tool ? { tool_calls: [{ index: 0, id: 'call-' + randomUUID(), type: 'function', function: tool }] } : { content: actual ? 'BROWSER_NATIVE_OK' : 'READY' }) }, finish_reason: tool ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    } catch (error) { inferenceError = String(error); response.writeHead(500).end('{}'); }
  }).listen(0, '127.0.0.1'); await once(inference, 'listening');
  const state = join(root, 'gateway'); await mkdir(state);
  await writeFile(join(state, 'models.json'), JSON.stringify({ providers: { 'browser-fixture': { baseUrl: `http://127.0.0.1:${inference.address().port}/v1`, apiKey: 'synthetic-fixture', api: 'openai-completions', models: [{ id: 'chat', name: 'Browser visual fixture', input: ['text', 'image'], reasoning: false, contextWindow: 128000, maxTokens: 2000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
  const probe = http.createServer().listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const config = join(state, 'xopc.json'); await writeFile(config, JSON.stringify({ gateway: { bind: 'loopback', port, auth: { mode: 'token', token } }, browser: { enabled: true }, computer: { enabled: false } }));
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
  const saved = await page.evaluate(async ({ origin, token }) => { const api = window.gatewayConnections; let result = await api.save((await api.snapshot()).epoch, { name: 'Native Browser fixture', origin, transport: 'ssh', credential: token }); if (!result.ok) return result; const id = result.snapshot.profiles[0].id; result = await api.select(result.snapshot.epoch, id); return result.ok ? api.connect(result.snapshot.epoch, id) : result; }, { origin: `http://127.0.0.1:${port}`, token });
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
  await until(() => chat.locator('#messages').textContent().then(text => text.includes('BROWSER_NATIVE_OK')), 120000);
  assert.equal((await (await fetch(new URL('count', fixtureUrl))).json()).count, beforeCount + 1); report.checks.actualBrowserSingleInput = true;
  const db = new DatabaseSync(join(state, 'xopc.db'), { readOnly: true });
  try {
    const rows = db.prepare("SELECT state,desktop_receipt_json FROM capability_operations WHERE desktop_intent_json LIKE '%desktop.browser.control%'").all();
    assert.equal(rows.length, 4); assert(rows.every(row => row.state === 'succeeded' && JSON.parse(row.desktop_receipt_json).executionStopped)); report.checks.durableNativeResults = true;
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
  for (const child of [gateway]) if (child?.exitCode === null && child.signalCode === null) {
    try { const exit = once(child, 'exit'); child.kill('SIGTERM'); await withTimeout(exit, 10000, 'Private fixture stop'); }
    catch { child.kill('SIGKILL'); report.passed = false; report.cleanupFailed = true; process.exitCode = 1; }
  }
  report.packageAfter = await installedAppFingerprint(target.application); if (report.packageBefore?.sha256 !== report.packageAfter.sha256) { report.passed = false; process.exitCode = 1; }
  if (report.passed) await rm(root, { recursive: true, force: true }); else report.tempRoot = root;
  report.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
