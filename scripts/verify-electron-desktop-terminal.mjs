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
const target = await macPackagedTarget(process.argv[index + 1]), output = await createAcceptanceOutput(join(process.cwd(), 'reports/p3-terminal-native.json'));
const root = await mkdtemp(join(tmpdir(), 'xopc-native-terminal-')), token = randomUUID(), peers = new Set(), workspaces = new Set();
const report = { passed: false, checks: {}, startedAt: new Date().toISOString(), scope: 'Installed Electron, actual native consent, independent device frames, real local Docker and same-host Gateway/Agent with synthetic inference. Private Docker fixtures only; not WAN or platform matrix acceptance. Terminal Native approval and actual PTY are required.' };
let terminal, app, gateway, inference, proxy, relay, workspaceId, imageId, inferenceError, logs = '';
const redact = text => String(text).replaceAll(token, '[redacted-owner]').replace(/xopc_(?:at|rt|pair)_[A-Za-z0-9_-]+/g, '[redacted-device]');
const inputFor = step => step === 'CANCEL' ? "printf 'DENIED_%s\\n' EFFECT\r" : "printf x >> /home/node/terminal-count; printf 'NATIVE_%s\\n' READY\r";
function findTerminal(value, depth = 0) {
  if (depth > 10 || value == null) return;
  if (typeof value === 'string') { try { return findTerminal(JSON.parse(value), depth + 1); } catch { return; } }
  if (typeof value !== 'object') return;
  if (typeof value.sessionId === 'string' && typeof value.generation === 'string' && typeof value.operationId === 'string') return value;
  for (const child of Object.values(value)) { const found = findTerminal(child, depth + 1); if (found) return found; }
}
async function until(probe, budget = 30000) {
  const deadline = Date.now() + budget;
  do { if (inferenceError) throw new Error(inferenceError); if (await probe()) return; await delay(100); } while (Date.now() < deadline);
  throw new Error('Container acceptance deadline exceeded');
}
const dockerArgs = ['--host', 'unix:///var/run/docker.sock'];
const volumesFor = id => execFileSync('docker', [...dockerArgs, 'volume', 'ls', '--filter', 'label=ai.xopc.workspace=' + id, '--format', '{{.Name}}'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
try {
  report.packageBefore = await installedAppFingerprint(target.application);
  inference = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks)), messages = body.messages ?? [], names = (body.tools ?? []).map(tool => tool.function?.name);
      const last = messages.findLastIndex(message => message.role === 'user' && JSON.stringify(message.content).includes('TERMINAL_CASE:'));
      const step = JSON.stringify(messages[last]?.content ?? '').match(/TERMINAL_CASE:([A-Z_]+)/)?.[1], results = messages.slice(last + 1).filter(message => message.role === 'tool');
      const actual = Boolean(step && names.includes('tool_search')); let tool;
      if (actual && !results.length) tool = { name: 'tool_search', arguments: JSON.stringify({ query: 'desktop terminal', limit: 5 }) };
      else if (actual && (results.length === 1 || step === 'READ' && results.length < 12 && !JSON.stringify(results).includes('NATIVE_READY'))) {
        const opening = step === 'OPEN';
        const name = names.find(name => name?.startsWith(opening ? 'device__desktop_terminal_open_' : 'device__desktop_terminal_control_')); assert(name); assert(workspaceId);
        if (!opening) assert(terminal);
        const args = opening ? { workspaceId, argv: ['/bin/sh'] } : { sessionId: terminal.sessionId, generation: terminal.generation,
          ...(step === 'CANCEL' || step === 'INPUT' ? { action: 'input', text: inputFor(step) } : step === 'RESIZE' ? { action: 'resize', columns: 100, rows: 30 } : { action: step === 'READ' ? 'read' : 'close' }) };
        tool = { name, arguments: JSON.stringify(args) };
      } else if (actual) {
        const encoded = JSON.stringify(results);
        if (step === 'OPEN') { terminal = findTerminal(results); assert(terminal); assert.equal(terminal.executionStopped, false); }
        if (step === 'CANCEL') assert(encoded.includes('notStarted'), 'Native cancelled stdin must be recorded as not dispatched');
        if (step === 'INPUT') assert(encoded.includes('accepted'));
        if (step === 'READ') { assert(encoded.includes('NATIVE_READY')); assert(!encoded.includes('DENIED_EFFECT')); }
        if (step === 'CLOSE') assert(encoded.includes('closed'));
      }
      const chunk = (delta, finish_reason = null) => 'data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'chat', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n';
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(chunk({ role: 'assistant' }) + (tool ? chunk({ tool_calls: [{ index: 0, id: randomUUID(), type: 'function', function: tool }] }) + chunk({}, 'tool_calls')
        : chunk({ content: actual ? 'TERMINAL_OK_' + step : 'Container fixture title' }) + chunk({}, 'stop')) + 'data: [DONE]\n\n');
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
        if (remote.readyState === WebSocket.OPEN) remote.send(bytes.toString());
      });
      remote.on('message', bytes => { if (local.readyState === WebSocket.OPEN) local.send(bytes.toString()); }); remote.once('close', () => local.terminate());
    }));
  });
  const origin = `http://127.0.0.1:${proxy.address().port}`, client = join(root, 'client'); await mkdir(client); const clientConfig = join(client, 'xopc.json'); await writeFile(clientConfig, '{invalid-local-config');
  app = await launchInstalledApplication(target, ['--gateway-connections'], { ...packagedAcceptanceEnvironment(localConnectionEnvironment(process.env, process.cwd(), client, clientConfig, join(client, 'workspace'))), XOPC_LOG_CONSOLE: 'true', XOPC_LOG_LEVEL: 'warn' }, root);
  report.runtime = app.metadata; const page = await app.firstWindow();
  const saved = await page.evaluate(async ({ origin, token }) => { const api = window.gatewayConnections; let result = await api.save((await api.snapshot()).epoch, { name: 'Native terminal fixture', origin, transport: 'ssh', credential: token }); if (!result.ok) return result; const id = result.snapshot.profiles[0].id; result = await api.select(result.snapshot.epoch, id); return result.ok ? api.connect(result.snapshot.epoch, id) : result; }, { origin, token }); assert(saved.ok, saved.error);
  const id = saved.snapshot.selectedId, chat = app.windows().find(window => window !== page), snapshot = () => page.evaluate(() => window.gatewayConnections.snapshot()); assert(chat);
  await chat.locator('#host-settings').click();
  const native = async (action, label, retainedWorkspace) => {
    console.log('NATIVE TERMINAL ' + label + '; PID ' + app.process().pid);
    const deadline = Date.now() + 120000; await until(async () => (await snapshot()).presentation.connectionFocused === true, 120000);
    return withTimeout(page.evaluate(async ({ action, id, retainedWorkspace }) => { const api = window.gatewayConnections, state = await api.snapshot(); return action === 'enroll' ? api.enrollDesktop(state.epoch, id) : api.startTerminal(state.epoch, id, retainedWorkspace); }, { action, id, retainedWorkspace }), Math.max(1, deadline - Date.now()), 'Native container approval deadline');
  };
  assert((await native('enroll', 'APPROVE device enrollment')).ok);
  const deviceId = (await snapshot()).desktop[id].deviceId; assert(deviceId);
  assert.equal((await native('container', 'CANCEL temporary Docker terminal grant')).error, 'DESKTOP_LOCAL_CONSENT_DENIED');
  const empty = await page.evaluate(async id => { const api = window.gatewayConnections; return api.listContainers((await api.snapshot()).epoch, id); }, id);
  assert(empty.ok, empty.error); assert.deepEqual(empty.snapshot.savedContainers.items, []);
  const grant = async retainedWorkspace => {
    const result = await native('container', retainedWorkspace ? 'APPROVE a fresh grant for the RETAINED Docker workspace' : 'APPROVE a fresh temporary Docker terminal grant', retainedWorkspace); assert(result.ok, result.error);
    await until(async () => (await snapshot()).execution?.state === 'online'); workspaceId = (await snapshot()).execution.workspaceId; assert(workspaceId); workspaces.add(workspaceId);
    const tools = (await owner('/api/endpoint-tools/devices')).flatMap(device => device.endpoints.flatMap(endpoint => endpoint.tools));
    const descriptor = tools.find(tool => tool.descriptor.name === 'desktop.terminal.open').descriptor; imageId = descriptor.description.match(/sha256:[a-f0-9]{64}/)?.[0]; assert(imageId);
  };
  await grant();
  const send = async step => {
    console.log('NATIVE TERMINAL ' + step + '; focus chat then choose matching native button');
    await chat.bringToFront(); await until(async () => (await snapshot()).presentation.chat.focused === true);
    await chat.locator('#use-host').check(); await chat.locator('#input').fill('TERMINAL_CASE:' + step); await chat.locator('#send').click();
    await until(() => chat.locator('#messages').textContent().then(text => text.includes('TERMINAL_OK_' + step)), 120000);
    report.checks[step] = true;
  };
  for (const step of ['OPEN', 'CANCEL', 'INPUT', 'READ', 'RESIZE', 'CLOSE']) await send(step);
  const db = new DatabaseSync(join(server, 'xopc.db'), { readOnly: true });
  try {
    const operation = db.prepare('SELECT state,desktop_receipt_json FROM capability_operations WHERE operation_id=?').get(terminal.operationId);
    assert.equal(operation.state, 'succeeded'); assert.equal(JSON.parse(operation.desktop_receipt_json).executionStopped, true);
  } finally { db.close(); }
  const names = volumesFor(workspaceId); assert.equal(names.length, 1);
  const count = execFileSync('docker', [...dockerArgs, 'run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--user', '1000:1000',
    '--mount', `type=volume,source=${names[0]},target=/home/node,readonly`, '--entrypoint', 'node', imageId, '-e', "process.stdout.write(require('fs').readFileSync('/home/node/terminal-count','utf8'))"], { encoding: 'utf8', timeout: 5000 });
  assert.equal(count, 'x'); report.checks.actualPtySingleInputAndRootStop = true;
  assert((await page.evaluate(() => window.gatewayConnections.stopExecution())).ok); report.passed = true;
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
