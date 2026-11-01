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

import WebSocket, { WebSocketServer } from 'ws';

import { createAcceptanceOutput, localConnectionEnvironment, withTimeout } from './electron-local-connection-support.mjs';
import { installedAppFingerprint, killAcceptanceApplication, launchInstalledApplication, macPackagedTarget, packagedAcceptanceEnvironment, packagedGatewayEnvironment } from './electron-packaged-acceptance.mjs';

const index = process.argv.indexOf('--app'); assert(index >= 0);
const target = await macPackagedTarget(process.argv[index + 1]), output = await createAcceptanceOutput(join(process.cwd(), 'reports/p3-container-native.json'));
const root = await mkdtemp(join(tmpdir(), 'xopc-native-container-')), token = randomUUID(), peers = new Set(), workspaces = new Set();
const report = { passed: false, checks: {}, startedAt: new Date().toISOString(), scope: 'Installed Electron, actual native consent, independent device frames, real local Docker and same-host Gateway/Agent with synthetic inference. Private Docker fixtures only; not WAN, PTY or platform matrix acceptance.' };
let app, gateway, inference, proxy, relay, workspaceId, imageId, inferenceError, dropNext = false, dropped, logs = '';
const redact = text => String(text).replaceAll(token, '[redacted-owner]').replace(/xopc_(?:at|rt|pair)_[A-Za-z0-9_-]+/g, '[redacted-device]');
const argvFor = step => ['node', '-e', ({
  CANCEL: "require('fs').writeFileSync('/home/node/denied.txt','must not exist')",
  APPROVE: "require('fs').writeFileSync('/home/node/fixture.txt','persisted fixture');console.log('CONTAINER_CREATED')",
  READ: "if(require('fs').existsSync('/home/node/denied.txt'))process.exit(42);console.log(require('fs').readFileSync('/home/node/fixture.txt','utf8'))",
  NONZERO: "require('fs').writeFileSync('/home/node/nonzero.txt','possible effect');console.log('EXIT_SEVEN');process.exit(7)",
  LOST: "require('fs').appendFileSync('/home/node/lost-count.txt','x');console.log('LOST_DONE')",
  AFTER_REVIEW: "if(require('fs').readFileSync('/home/node/fixture.txt','utf8')!=='persisted fixture')process.exit(9);console.log('FRESH_INTENT')",
})[step]];
async function until(probe, budget = 30000) {
  const deadline = Date.now() + budget;
  do { if (inferenceError) throw new Error(inferenceError); if (await probe()) return; await delay(100); } while (Date.now() < deadline);
  throw new Error('Container acceptance deadline exceeded');
}
const dockerArgs = ['--host', 'unix:///var/run/docker.sock'];
const volumesFor = id => execFileSync('docker', [...dockerArgs, 'volume', 'ls', '--filter', 'label=ai.xopc.workspace=' + id, '--format', '{{.Name}}'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
function verifyLostVolume(id) {
  const names = volumesFor(id); assert.equal(names.length, 1); assert(new RegExp(`^xopc-workspace-[a-f0-9-]{36}-${id}$`).test(names[0]));
  const text = execFileSync('docker', [...dockerArgs, 'run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '1000:1000',
    '--mount', `type=volume,source=${names[0]},target=/home/node,readonly`, '--entrypoint', 'node', imageId, '-e', "process.stdout.write(require('fs').readFileSync('/home/node/lost-count.txt','utf8'))"], { encoding: 'utf8', timeout: 5000 });
  assert.equal(text, 'x', 'Unknown command must never be replayed');
}
try {
  report.packageBefore = await installedAppFingerprint(target.application);
  inference = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks)), messages = body.messages ?? [], names = (body.tools ?? []).map(tool => tool.function?.name);
      const last = messages.findLastIndex(message => message.role === 'user' && JSON.stringify(message.content).includes('CONTAINER_CASE:'));
      const step = JSON.stringify(messages[last]?.content ?? '').match(/CONTAINER_CASE:([A-Z_]+)/)?.[1], results = messages.slice(last + 1).filter(message => message.role === 'tool');
      const actual = Boolean(step && names.includes('tool_search')); let tool;
      if (actual && !results.length) tool = { name: 'tool_search', arguments: JSON.stringify({ query: 'desktop command run', limit: 5 }) };
      else if (actual && results.length === 1) {
        const name = names.find(name => name?.startsWith('device__desktop_command_run_')); assert(name); assert(workspaceId);
        tool = { name, arguments: JSON.stringify({ workspaceId, argv: argvFor(step) }) };
      } else if (actual) {
        const encoded = JSON.stringify(results);
        for (const [name, expected] of Object.entries({ APPROVE: 'CONTAINER_CREATED', READ: 'persisted fixture', NONZERO: 'EXIT_SEVEN', AFTER_REVIEW: 'FRESH_INTENT' })) if (step === name) assert(encoded.includes(expected), 'Actual Docker output must reach the Agent: ' + name);
        if (step === 'LOST') assert(dropped, 'A real persisted signed completion must be dropped');
      }
      const chunk = (delta, finish_reason = null) => 'data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'chat', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n';
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(chunk({ role: 'assistant' }) + (tool ? chunk({ tool_calls: [{ index: 0, id: randomUUID(), type: 'function', function: tool }] }) + chunk({}, 'tool_calls')
        : chunk({ content: actual ? 'CONTAINER_OK_' + step : 'Container fixture title' }) + chunk({}, 'stop')) + 'data: [DONE]\n\n');
    } catch (error) { inferenceError = String(error); response.writeHead(500).end('{}'); }
  }).listen(0, '127.0.0.1'); await once(inference, 'listening');
  const server = join(root, 'gateway'); await mkdir(server);
  await writeFile(join(server, 'models.json'), JSON.stringify({ providers: { 'container-fixture': { baseUrl: `http://127.0.0.1:${inference.address().port}/v1`, apiKey: 'synthetic-fixture', api: 'openai-completions', models: [{ id: 'chat', name: 'Container fixture', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 2000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
  const probe = http.createServer().listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const config = join(server, 'xopc.json'); await writeFile(config, JSON.stringify({ gateway: { bind: 'loopback', port, auth: { mode: 'token', token } }, browser: { enabled: false } }));
  gateway = spawn(target.executablePath, [target.server, 'gateway', '--foreground', '--bind', 'loopback', '--port', String(port), '--no-hot-reload'], {
    cwd: root, env: packagedGatewayEnvironment(localConnectionEnvironment(process.env, process.cwd(), server, config, join(server, 'workspace')), target), stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [gateway.stdout, gateway.stderr]) stream.on('data', bytes => { logs = (logs + redact(bytes)).slice(-16000); });
  const owner = async (path, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    assert(response.ok, `Fixture request ${path}: ${response.status}`); const result = await response.json(); return result.payload ?? result;
  };
  await until(() => owner('/api/desktop-host/compatibility').then(() => true).catch(() => false), 60000);
  const { defaults } = await owner('/api/global-defaults'); defaults.models.chat = { primary: 'container-fixture/chat', fallbacks: [] }; await owner('/api/global-defaults', 'PATCH', { defaults, scope: 'models' });
  const agents = await owner('/api/agents'), agent = agents.agents.find(item => item.id === agents.defaultId) ?? agents.agents[0];
  await owner(`/api/agents/${agent.id}`, 'PATCH', { models: { chat: { primary: 'container-fixture/chat', fallbacks: [] } }, runtime: { codemode: { enabled: true } } });
  proxy = http.createServer((request, response) => { const upstream = http.request({ host: '127.0.0.1', port, method: request.method, path: request.url, headers: request.headers }, value => { response.writeHead(value.statusCode, value.headers); value.pipe(response); }); upstream.on('error', () => response.destroy()); request.pipe(upstream); }).listen(0, '127.0.0.1'); await once(proxy, 'listening');
  relay = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  proxy.on('upgrade', (request, socket, head) => {
    const remote = new WebSocket(`ws://127.0.0.1:${port}${request.url}`, { ...(request.headers.origin ? { origin: request.headers.origin } : {}), maxPayload: 768 * 1024, followRedirects: false });
    peers.add(remote); remote.once('close', () => peers.delete(remote)); remote.on('error', () => socket.destroy()); socket.once('error', () => remote.terminate());
    remote.once('open', () => relay.handleUpgrade(request, socket, head, local => {
      peers.add(local); local.once('close', () => { peers.delete(local); remote.terminate(); }); local.on('error', () => remote.terminate());
      local.on('message', bytes => { const message = JSON.parse(bytes.toString());
        if (dropNext && message.kind === 'desktop.endpoint.message' && message.payload?.message?.type === 'tool.result' && message.payload.message.payload.operationReceipt?.state === 'succeeded') {
          dropped = { operationId: message.payload.message.payload.operationReceipt.operationId }; dropNext = false; local.close(1011, 'Fixture drops persisted container result'); remote.terminate(); return;
        }
        if (remote.readyState === WebSocket.OPEN) remote.send(bytes.toString());
      });
      remote.on('message', bytes => { if (local.readyState === WebSocket.OPEN) local.send(bytes.toString()); }); remote.once('close', () => local.terminate());
    }));
  });
  const origin = `http://127.0.0.1:${proxy.address().port}`, client = join(root, 'client'); await mkdir(client); const clientConfig = join(client, 'xopc.json'); await writeFile(clientConfig, '{invalid-local-config');
  app = await launchInstalledApplication(target, ['--gateway-connections'], packagedAcceptanceEnvironment(localConnectionEnvironment(process.env, process.cwd(), client, clientConfig, join(client, 'workspace'))), root);
  report.runtime = app.metadata; const page = await app.firstWindow();
  const saved = await page.evaluate(async ({ origin, token }) => { const api = window.gatewayConnections; let result = await api.save((await api.snapshot()).epoch, { name: 'Native container fixture', origin, transport: 'ssh', credential: token }); if (!result.ok) return result; const id = result.snapshot.profiles[0].id; result = await api.select(result.snapshot.epoch, id); return result.ok ? api.connect(result.snapshot.epoch, id) : result; }, { origin, token }); assert(saved.ok, saved.error);
  const id = saved.snapshot.selectedId, chat = app.windows().find(window => window !== page), snapshot = () => page.evaluate(() => window.gatewayConnections.snapshot()); assert(chat);
  await chat.locator('#host-settings').click();
  const native = async (action, label, retainedWorkspace) => {
    console.log('NATIVE CONTAINER ' + label + '; PID ' + app.process().pid);
    const deadline = Date.now() + 120000; await until(async () => (await snapshot()).presentation.connectionFocused === true, 120000);
    return withTimeout(page.evaluate(async ({ action, id, retainedWorkspace }) => { const api = window.gatewayConnections, state = await api.snapshot(); return action === 'enroll' ? api.enrollDesktop(state.epoch, id) : api.startContainer(state.epoch, id, retainedWorkspace); }, { action, id, retainedWorkspace }), Math.max(1, deadline - Date.now()), 'Native container approval deadline');
  };
  assert((await native('enroll', 'APPROVE device enrollment')).ok);
  const deviceId = (await snapshot()).desktop[id].deviceId; assert(deviceId);
  assert.equal((await native('container', 'CANCEL temporary Docker grant')).error, 'DESKTOP_LOCAL_CONSENT_DENIED');
  const empty = await page.evaluate(async id => { const api = window.gatewayConnections; return api.listContainers((await api.snapshot()).epoch, id); }, id);
  assert(empty.ok, empty.error); assert.deepEqual(empty.snapshot.savedContainers.items, []);
  const grant = async retainedWorkspace => {
    const result = await native('container', retainedWorkspace ? 'APPROVE a fresh grant for the RETAINED Docker workspace' : 'APPROVE a fresh temporary Docker grant', retainedWorkspace); assert(result.ok, result.error);
    await until(async () => (await snapshot()).execution?.state === 'online'); workspaceId = (await snapshot()).execution.workspaceId; assert(workspaceId); workspaces.add(workspaceId);
    const tools = (await owner('/api/endpoint-tools/devices')).flatMap(device => device.endpoints.flatMap(endpoint => endpoint.tools));
    const descriptor = tools.find(tool => tool.descriptor.name === 'desktop.command.run').descriptor; imageId = descriptor.description.match(/sha256:[a-f0-9]{64}/)?.[0]; assert(imageId);
  };
  await grant();
  const send = async step => {
    const before = new Set((await owner(`/api/endpoint-tools/invocations?principalId=${deviceId}`)).items.map(item => item.id));
    console.log('NATIVE CONTAINER ' + step + '; focus chat then choose matching native command button');
    await chat.bringToFront(); await until(async () => (await snapshot()).presentation.chat.focused === true);
    await chat.locator('#use-host').check(); await chat.locator('#input').fill('CONTAINER_CASE:' + step); await chat.locator('#send').click();
    await until(() => chat.locator('#messages').textContent().then(text => text.includes('CONTAINER_OK_' + step)), 120000);
    if (step === 'CANCEL') assert((await owner(`/api/endpoint-tools/invocations?principalId=${deviceId}`)).items.some(item => !before.has(item.id) && item.toolName === 'desktop.command.run' && item.errorCode === 'USER_DENIED'), 'Cancellation needs this native USER_DENIED audit');
    report.checks[step] = true;
  };
  for (const step of ['CANCEL', 'APPROVE', 'READ', 'NONZERO', 'LOST']) {
    if (step === 'LOST') dropNext = true; await send(step);
    // Native interaction is measured inside the unchanged two-minute grant. Each small group gets fresh consent.
    if (step === 'APPROVE' || step === 'NONZERO') {
      const previousWorkspace = workspaceId;
      const stopped = await page.evaluate(() => window.gatewayConnections.stopExecution()); assert(stopped.ok, stopped.error);
      await chat.locator('#host-settings').click(); await grant(previousWorkspace);
      assert.equal(workspaceId, previousWorkspace);
    }
  }
  const oldWorkspace = workspaceId; verifyLostVolume(oldWorkspace); assert(dropped); report.dropped = dropped;
  const state = () => { const db = new DatabaseSync(join(server, 'xopc.db'), { readOnly: true }); try { return db.prepare('SELECT state FROM capability_operations WHERE operation_id=?').get(dropped.operationId)?.state; } finally { db.close(); } };
  assert.equal(state(), 'unknown'); await chat.locator('#host-settings').click();
  const listed = await page.evaluate(async id => { const api = window.gatewayConnections; return api.listOperations((await api.snapshot()).epoch, id); }, id); assert(listed.ok, listed.error);
  for (const approve of [false, true]) {
    console.log('NATIVE CONTAINER ' + (approve ? 'APPROVE' : 'CANCEL') + ' unknown command review after inspecting the private volume');
    const result = await withTimeout(page.evaluate(async ({ id, operationId }) => { const api = window.gatewayConnections; return api.reviewOperation((await api.snapshot()).epoch, id, operationId); }, { id, ...dropped }), 120000, 'Native command review deadline');
    if (approve) assert(result.ok, result.error); else assert.equal(result.error, 'DESKTOP_LOCAL_CONSENT_DENIED'); assert.equal(state(), 'unknown'); verifyLostVolume(oldWorkspace);
  }
  const retained = await page.evaluate(async id => { const api = window.gatewayConnections; return api.listContainers((await api.snapshot()).epoch, id); }, id);
  assert(retained.ok, retained.error); assert(retained.snapshot.savedContainers.items.some(item => item.workspaceId === oldWorkspace));
  assert(retained.snapshot.savedContainers.items.every(item => Object.keys(item).sort().join(',') === 'imageId,label,workspaceId'));
  await grant(oldWorkspace); assert.equal(workspaceId, oldWorkspace); await send('AFTER_REVIEW'); verifyLostVolume(oldWorkspace); assert.equal(state(), 'unknown');
  assert((await page.evaluate(() => window.gatewayConnections.stopExecution())).ok); report.checks.nativeUnknownReviewAndFreshGrant = true; report.passed = true;
} catch (error) { report.error = redact(error?.stack ?? error); report.logs = logs; if (app) report.applicationOutput = redact(app.output()); process.exitCode = 1; }
finally {
  if (app) { try { await withTimeout(app.close(), 10000, 'Container application stop'); } catch { killAcceptanceApplication(app); } }
  inference?.closeAllConnections(); if (inference) await new Promise(resolve => inference.close(resolve));
  for (const peer of peers) peer.terminate(); relay?.close(); proxy?.closeAllConnections(); if (proxy) await new Promise(resolve => proxy.close(resolve));
  if (gateway?.exitCode === null) { try { const exit = once(gateway, 'exit'); gateway.kill('SIGTERM'); await withTimeout(exit, 10000, 'Container Gateway stop'); } catch { gateway.kill('SIGKILL'); report.passed = false; report.cleanupFailed = true; process.exitCode = 1; } }
  report.packageAfter = await installedAppFingerprint(target.application); if (report.packageAfter.sha256 !== report.packageBefore?.sha256) { report.passed = false; process.exitCode = 1; }
  if (report.passed) {
    for (const id of workspaces) for (const volume of volumesFor(id)) { assert(new RegExp(`^xopc-workspace-[a-f0-9-]{36}-${id}$`).test(volume)); execFileSync('docker', [...dockerArgs, 'volume', 'rm', volume], { stdio: 'ignore' }); }
    await rm(root, { recursive: true, force: true });
  } else { report.failureStateDirectory = root; report.retainedFixtureWorkspaces = [...workspaces]; }
  report.finishedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
