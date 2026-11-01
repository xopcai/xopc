import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

import WebSocket, { WebSocketServer } from 'ws';

import { createAcceptanceOutput, localConnectionEnvironment, withTimeout } from './electron-local-connection-support.mjs';
import { installedAppFingerprint, killAcceptanceApplication, launchInstalledApplication, macPackagedTarget, packagedAcceptanceEnvironment, packagedGatewayEnvironment } from './electron-packaged-acceptance.mjs';

const index = process.argv.indexOf('--app'); assert(index >= 0);
const target = await macPackagedTarget(process.argv[index + 1]);
const output = await createAcceptanceOutput(join(process.cwd(), 'reports/p3-native-workspace.json'));
const skipFolderCancellation = process.argv.includes('--skip-folder-cancel-cases');
const lostResultReview = process.argv.includes('--lost-result-review');
const root = await mkdtemp(join(tmpdir(), 'xopc-native-workspace-')), token = randomUUID();
const fixture = join(root, 'authorized-fixture'), original = 'Original fixture ' + randomUUID(), replacement = 'Written fixture ' + randomUUID();
const digest = value => createHash('sha256').update(value).digest('hex');
const report = { passed: false, startedAt: new Date().toISOString(), scope: 'Installed Electron, actual native folder/grant/per-call consent, same-host bundled Gateway, real filesystem and synthetic Agent inference. Private fixture only; no physical WAN/platform matrix claim.', checks: {} };
report.folderCancellationCovered = !skipFolderCancellation;
let app, gateway, inference, proxy, relay, droppedResult, workspaceId, inferenceError, logs = '', readSeen = false, writeSeen = false, conflictSeen = false;
const peers = new Set();
const redact = value => String(value).replaceAll(token, '[redacted-owner]').replace(/xopc_(?:at|rt|pair)_[A-Za-z0-9_-]+/g, '[redacted-device]');
async function until(probe, budget = 30000) {
  const deadline = Date.now() + budget;
  do { if (inferenceError) throw new Error(inferenceError); if (await probe()) return; await delay(100); } while (Date.now() < deadline);
  throw new Error('Workspace acceptance deadline exceeded');
}
try {
  report.packageBefore = await installedAppFingerprint(target.application);
  await mkdir(fixture); await writeFile(join(fixture, 'fixture.txt'), original);
  inference = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()), messages = body.messages ?? [];
      const last = messages.findLastIndex(message => message.role === 'user' && JSON.stringify(message.content).includes('WORKSPACE_CASE:'));
      const step = JSON.stringify(messages[last]?.content ?? '').match(/WORKSPACE_CASE:([A-Z_]+)/)?.[1];
      const results = messages.slice(last + 1).filter(message => message.role === 'tool'), names = (body.tools ?? []).map(tool => tool.function?.name);
      const agentRequest = Boolean(step && names.includes('tool_search'));
      report.inferenceRequests ??= [];
      if (report.inferenceRequests.length < 60) report.inferenceRequests.push({ step, tools: names.slice(0, 32), results: results.length, agentRequest });
      const action = step?.startsWith('READ') ? 'read' : 'write'; let tool;
      if (agentRequest && !results.length) tool = { name: 'tool_search', arguments: JSON.stringify({ query: 'desktop workspace ' + action, limit: 5 }) };
      else if (agentRequest && results.length === 1) {
        const name = names.find(name => name?.startsWith(`device__desktop_workspace_${action}_`)); assert(name, 'Workspace tool discovery missing'); assert(workspaceId);
        tool = { name, arguments: JSON.stringify({ workspaceId, relativePath: 'fixture.txt', ...(action === 'write' ? { text: replacement, expectedVersion: digest(original) } : {}) }) };
      } else if (agentRequest) {
        const value = JSON.stringify(results);
        if (step === 'READ_APPROVE') { assert(value.includes(original), 'Actual selected file was not projected to the Agent'); readSeen = true; }
        if (step === 'WRITE_APPROVE') {
          if (lostResultReview) assert(droppedResult, 'Must drop an actual persisted signed success frame');
          else assert(value.includes(digest(replacement)), 'Native write version did not reach the Agent');
          writeSeen = true;
        }
        if (step === 'WRITE_CONFLICT') { assert(value.includes('WORKSPACE_VERSION_CONFLICT')); conflictSeen = true; }
      }
      const chunk = (delta, finish_reason = null) => 'data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'chat', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n';
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(chunk({ role: 'assistant' }) + (tool ? chunk({ tool_calls: [{ index: 0, id: randomUUID(), type: 'function', function: tool }] }) + chunk({}, 'tool_calls')
        : chunk({ content: agentRequest ? 'WORKSPACE_OK_' + step : 'Workspace fixture title' }) + chunk({}, 'stop')) + 'data: [DONE]\n\n');
    } catch (error) { inferenceError = String(error); response.writeHead(500).end('{}'); }
  }).listen(0, '127.0.0.1'); await once(inference, 'listening');
  const server = join(root, 'gateway'); await mkdir(server);
  await writeFile(join(server, 'models.json'), JSON.stringify({ providers: { 'workspace-fixture': { baseUrl: `http://127.0.0.1:${inference.address().port}/v1`, apiKey: 'synthetic-fixture', api: 'openai-completions', models: [{ id: 'chat', name: 'Workspace fixture', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 2000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
  const probe = http.createServer().listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  let origin = `http://127.0.0.1:${port}`;
  const config = join(server, 'xopc.json');
  await writeFile(config, JSON.stringify({ gateway: { bind: 'loopback', port, auth: { mode: 'token', token } }, browser: { enabled: false } }), { mode: 0o600 });
  gateway = spawn(target.executablePath, [target.server, 'gateway', '--foreground', '--bind', 'loopback', '--port', String(port), '--no-hot-reload'], {
    cwd: root, env: packagedGatewayEnvironment(localConnectionEnvironment(process.env, process.cwd(), server, config, join(server, 'workspace')), target), stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [gateway.stdout, gateway.stderr]) stream.on('data', chunk => { logs = (logs + redact(chunk)).slice(-16000); });
  const owner = async (path, method = 'GET', body) => {
    const response = await fetch(origin + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    assert(response.ok, `Fixture request ${path}: ${response.status}`); const value = await response.json(); return value.payload ?? value;
  };
  await until(() => owner('/api/desktop-host/compatibility').then(() => true).catch(() => false), 60000);
  if (lostResultReview) {
    proxy = http.createServer((request, response) => {
      const upstream = http.request({ host: '127.0.0.1', port, path: request.url, method: request.method, headers: request.headers }, value => {
        response.writeHead(value.statusCode, value.headers); value.pipe(response);
      });
      upstream.on('error', () => response.destroy()); request.pipe(upstream);
    }).listen(0, '127.0.0.1'); await once(proxy, 'listening');
    relay = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
    proxy.on('upgrade', (request, socket, head) => {
      const remote = new WebSocket(`ws://127.0.0.1:${port}${request.url}`, { ...(request.headers.origin ? { origin: request.headers.origin } : {}), followRedirects: false, maxPayload: 768 * 1024 });
      peers.add(remote); remote.once('close', () => peers.delete(remote));
      remote.on('error', () => socket.destroy()); socket.once('error', () => remote.terminate());
      remote.once('open', () => relay.handleUpgrade(request, socket, head, local => {
        peers.add(local); local.once('close', () => { peers.delete(local); remote.terminate(); }); local.on('error', () => remote.terminate());
        local.on('message', bytes => {
          const message = JSON.parse(bytes.toString());
          if (!droppedResult && message.kind === 'desktop.endpoint.message' && message.payload?.message?.type === 'tool.result'
            && message.payload.message.payload.operationReceipt?.state === 'succeeded') {
            droppedResult = { operationId: message.payload.message.payload.operationReceipt.operationId };
            local.close(1011, 'Fixture dropped persisted file completion'); remote.terminate(); return;
          }
          if (remote.readyState === WebSocket.OPEN) remote.send(bytes.toString());
        });
        remote.on('message', bytes => { if (local.readyState === WebSocket.OPEN) local.send(bytes.toString()); });
        remote.once('close', () => local.terminate());
      }));
    });
    origin = `http://127.0.0.1:${proxy.address().port}`;
  }
  const { defaults } = await owner('/api/global-defaults'); defaults.models.chat = { primary: 'workspace-fixture/chat', fallbacks: [] };
  await owner('/api/global-defaults', 'PATCH', { defaults, scope: 'models' });
  const catalog = await owner('/api/agents'), agent = catalog.agents.find(item => item.id === catalog.defaultId) ?? catalog.agents[0];
  await owner(`/api/agents/${agent.id}`, 'PATCH', { models: { chat: { primary: 'workspace-fixture/chat', fallbacks: [] } }, runtime: { codemode: { enabled: true } } });
  const client = join(root, 'client'); await mkdir(client); const clientConfig = join(client, 'xopc.json'); await writeFile(clientConfig, '{invalid-local-config');
  const applicationEnv = packagedAcceptanceEnvironment(localConnectionEnvironment(process.env, process.cwd(), client, clientConfig, join(client, 'workspace')));
  applicationEnv.XOPC_LOG_CONSOLE = 'true';
  app = await launchInstalledApplication(target, ['--gateway-connections'], applicationEnv, root);
  report.runtime = app.metadata; const page = await app.firstWindow(); page.setDefaultTimeout(30000);
  await page.getByRole('heading', { name: 'Gateway 连接预览' }).waitFor();
  const saved = await page.evaluate(async ({ origin, token }) => {
    const api = window.gatewayConnections, state = await api.snapshot(); let result = await api.save(state.epoch, { name: 'Native workspace fixture', origin, transport: 'ssh', credential: token });
    if (!result.ok) return result; const id = result.snapshot.profiles[0].id;
    result = await api.select(result.snapshot.epoch, id); if (!result.ok) return result; return api.connect(result.snapshot.epoch, id);
  }, { origin, token }); assert(saved.ok, saved.error);
  const id = saved.snapshot.selectedId, chat = app.windows().find(window => window !== page); assert(chat);
  await chat.locator('#host-settings').click();
  const snapshot = () => page.evaluate(() => window.gatewayConnections.snapshot());
  const action = async (name, label) => {
    console.log('NATIVE ' + label + '; PID ' + app.process().pid);
    const deadline = Date.now() + 120000;
    await until(async () => (await snapshot()).presentation.connectionFocused === true, Math.max(1, deadline - Date.now()));
    const result = await withTimeout(page.evaluate(async ({ id, name }) => {
      const api = window.gatewayConnections, state = await api.snapshot();
      return name === 'enroll' ? api.enrollDesktop(state.epoch, id) : api.startWorkspace(state.epoch, id);
    }, { id, name }), Math.max(1, deadline - Date.now()), 'Native workspace action deadline exceeded');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    return result;
  };
  assert((await action('enroll', 'APPROVE device enrollment')).ok);
  assert.equal((await snapshot()).desktop[id].state, 'registered');
  const deviceId = (await snapshot()).desktop[id].deviceId; assert(deviceId);
  console.log('NATIVE FOLDER select ONLY private fixture: ' + fixture);
  if (!skipFolderCancellation) {
  assert.equal((await action('execute-workspace', 'CANCEL the native folder picker')).error, 'DESKTOP_LOCAL_CONSENT_DENIED');
  assert.equal((await owner('/api/endpoint-tools/devices')).find(device => device.id === deviceId).endpoints.length, 0);
  report.checks.cancelFolderExposesNoEndpoint = true;
  assert.equal((await action('execute-workspace', 'SELECT private fixture folder then CANCEL temporary workspace grant')).error, 'DESKTOP_LOCAL_CONSENT_DENIED');
  assert.equal((await owner('/api/endpoint-tools/devices')).find(device => device.id === deviceId).endpoints.length, 0);
  assert.equal((await snapshot()).execution?.state, 'stopped');
  report.checks.cancelGrantExposesNoEndpoint = true;
  }
  const approveWorkspace = async label => {
  const allowed = await action('execute-workspace', label); assert(allowed.ok, allowed.error);
  await until(async () => (await snapshot()).execution?.state === 'online');
  const registered = (await owner('/api/endpoint-tools/devices')).find(device => device.id === deviceId);
  assert(!JSON.stringify(registered).includes(fixture), 'Absolute local root leaked into the Gateway device record');
  const descriptor = registered.endpoints[0].tools.find(tool => tool.descriptor.name === 'desktop.workspace.write').descriptor;
  workspaceId = descriptor.description.match(/workspace ID: ([0-9a-f-]{36})/)?.[1]; assert(workspaceId);
  report.nativeWorkspaces ??= []; assert(!report.nativeWorkspaces.includes(workspaceId)); report.nativeWorkspaces.push(workspaceId);
  report.checks.nativeFolderGrantAndRemotePathIsolation = true;
  };
  await approveWorkspace('SELECT private fixture folder then APPROVE temporary workspace grant');
  for (const step of lostResultReview ? ['WRITE_APPROVE'] : ['READ_CANCEL', 'READ_APPROVE', 'WRITE_CANCEL', 'WRITE_APPROVE', 'WRITE_CONFLICT']) {
    if (step === 'WRITE_CANCEL' || step === 'WRITE_CONFLICT') {
      const stopped = await page.evaluate(() => window.gatewayConnections.stopExecution()); assert(stopped.ok);
      await until(async () => (await snapshot()).execution?.state === 'stopped');
      await chat.locator('#host-settings').click();
      await approveWorkspace('SELECT the same private fixture and APPROVE a fresh grant for ' + step);
    }
    const before = new Set((await owner(`/api/endpoint-tools/invocations?principalId=${deviceId}`)).items.map(item => item.id));
    if (step === 'WRITE_CONFLICT') await writeFile(join(fixture, 'fixture.txt'), 'External fixture edit');
    console.log('NATIVE ' + step + '; focus actual chat then choose matching native button');
    await chat.bringToFront(); await until(async () => (await snapshot()).presentation.chat.focused === true, 30000);
    await chat.locator('#use-host').check(); await chat.locator('#input').fill('WORKSPACE_CASE:' + step); await chat.locator('#send').click();
    await until(async () => (await chat.locator('#messages').textContent()).includes('WORKSPACE_OK_' + step), 120000);
    const audits = await owner(`/api/endpoint-tools/invocations?principalId=${deviceId}`);
    if (step.endsWith('CANCEL')) assert(audits.items.some(item => !before.has(item.id) && item.toolName === `desktop.workspace.${step.startsWith('READ') ? 'read' : 'write'}` && item.errorCode === 'USER_DENIED'), 'Native cancellation requires a new matching USER_DENIED audit');
    const actual = await readFile(join(fixture, 'fixture.txt'), 'utf8');
    assert.equal(actual, step === 'WRITE_APPROVE' ? replacement : step === 'WRITE_CONFLICT' ? 'External fixture edit' : original);
    report.checks[step] = true;
    if (step === 'WRITE_APPROVE') {
      const recovery = join(client, 'desktop-execution-v1', 'workspace-recovery'), names = await readdir(recovery);
      assert.equal(names.length, 1);
      const encrypted = await readFile(join(recovery, names[0]));
      assert(!encrypted.includes(Buffer.from(fixture)) && !encrypted.includes(Buffer.from(replacement)));
      report.checks.encryptedRecoveryLocationPersisted = true;
    }
  }
  if (lostResultReview) {
    assert(writeSeen && droppedResult); report.droppedResult = droppedResult;
    const state = () => { const database = new DatabaseSync(join(server, 'xopc.db'), { readOnly: true }); try { return database.prepare('SELECT state FROM capability_operations WHERE operation_id=?').get(droppedResult.operationId)?.state; } finally { database.close(); } };
    assert.equal(state(), 'unknown');
    await chat.locator('#host-settings').click();
    const listed = await page.evaluate(async id => { const api = window.gatewayConnections; return api.listOperations((await api.snapshot()).epoch, id); }, id); assert(listed.ok, listed.error);
    for (const approve of [false, true]) {
      console.log('NATIVE ' + (approve ? 'APPROVE' : 'CANCEL') + ' unknown FILE review; verify original root, relative path and directory identity');
      const reviewed = await withTimeout(page.evaluate(async ({ id, operationId }) => { const api = window.gatewayConnections; return api.reviewOperation((await api.snapshot()).epoch, id, operationId); }, { id, ...droppedResult }), 120000, 'Native file review deadline');
      if (approve) assert(reviewed.ok, reviewed.error); else assert.equal(reviewed.error, 'DESKTOP_LOCAL_CONSENT_DENIED');
      assert.equal(state(), 'unknown'); assert.equal(await readFile(join(fixture, 'fixture.txt'), 'utf8'), replacement);
    }
    report.checks.nativeFileReviewKeepsUnknownWithoutReplay = true;
  } else { assert(readSeen && writeSeen && conflictSeen); report.checks.actualAgentReadWriteAndConflict = true; }
  await page.locator('#execution-stop').evaluate(button => button.click());
  await until(async () => (await snapshot()).execution?.state === 'stopped');
  assert.equal((await owner('/api/endpoint-tools/devices')).find(device => device.id === deviceId).endpoints.length, 0);
  report.checks.stopRevokesNativeWorkspace = true; report.passed = true;
} catch (error) { report.error = redact(error?.stack ?? error); report.logs = logs; if (app) report.applicationOutput = redact(app.output()); process.exitCode = 1; }
finally {
  if (app) { try { await withTimeout(app.close(), 10000, 'Workspace application stop'); } catch { killAcceptanceApplication(app); } }
  inference?.closeAllConnections(); if (inference) await new Promise(resolve => inference.close(resolve));
  for (const peer of peers) peer.terminate(); relay?.close();
  proxy?.closeAllConnections(); if (proxy) await new Promise(resolve => proxy.close(resolve));
  if (gateway?.exitCode === null) {
    try { const ended = once(gateway, 'exit'); gateway.kill('SIGTERM'); await withTimeout(ended, 10000, 'Workspace fixture stop'); }
    catch { gateway.kill('SIGKILL'); report.cleanupFailed = true; report.passed = false; process.exitCode = 1; }
  }
  report.packageAfter = await installedAppFingerprint(target.application);
  if (report.packageAfter.sha256 !== report.packageBefore.sha256) { report.passed = false; report.packageMutated = true; process.exitCode = 1; }
  if (report.passed) await rm(root, { recursive: true, force: true }); else report.failureStateDirectory = root;
  report.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
