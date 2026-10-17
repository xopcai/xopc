/** Opt-in real macOS / hosted-model / Gateway-network matrix. No phase is retried. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { APP, WINDOW, EXPECT } from './lib/computer-flow-network-target.mjs';
import { createComputerFlowNetworkProxy } from './lib/computer-flow-network-proxy.mjs';
import { REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';
const { WebSocket } = createRequire(import.meta.url)('ws') as typeof import('ws');

assert.equal(process.platform, 'darwin');
assert.equal(process.argv.length, 2, 'This opt-in check takes no arguments');
assert.ok(process.env.DASHSCOPE_API_KEY, 'Requires the existing DASHSCOPE_API_KEY');
const repo = resolve(import.meta.dirname, '..'), root = await mkdtemp(join(tmpdir(), 'xopc-network-flow-'));
const cache = join(repo, '.cache/flow-network'); await mkdir(cache, { recursive: true });
const electron = createRequire(import.meta.url)('electron') as string;
await build({ entryPoints: [join(repo, 'scripts/verify-computer-network-desktop.mts')], outfile: join(cache, 'desktop.mjs'),
  bundle: true, platform: 'node', format: 'esm', external: ['electron', '@trycua/cua-driver', '@earendil-works/*', 'sharp', 'better-sqlite3'],
  banner: { js: 'import { createRequire as __flowRequire } from "node:module"; const require = __flowRequire(import.meta.url);' } });
const fixturePath = join(cache, 'XOPCFlowValidation.app/Contents');
await mkdir(join(fixturePath, 'MacOS'), { recursive: true });
await writeFile(join(fixturePath, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${APP}</string><key>CFBundleExecutable</key><string>FlowValidation</string><key>CFBundleName</key><string>XOPC Flow Validation</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>`);
execFileSync('xcrun', ['swiftc', join(repo, 'scripts/fixtures/ComputerFlowValidation.swift'), '-o', join(fixturePath, 'MacOS/FlowValidation')], { timeout: 60_000 });
const fixture = spawn('/usr/bin/open', ['-n', '-W', join(cache, 'XOPCFlowValidation.app'), '--args', join(root, 'fixture.pid'), String(process.pid)], { stdio: 'ignore' });
let fixturePid: number | undefined;
process.on('exit', () => { if (fixturePid) { try { process.kill(fixturePid); } catch { /* Already stopped. */ } } fixture.kill(); });
const fixtureDeadline = Date.now() + 15_000;
while (!fixturePid) {
  fixturePid = await readFile(join(root, 'fixture.pid'), 'utf8').then(v => Number(v), () => undefined);
  assert.ok(Date.now() < fixtureDeadline, 'Native fixture did not launch');
  if (!fixturePid) await new Promise(r => setTimeout(r, 50));
}
const fixtureMetadata = JSON.parse(await readFile(join(root, 'fixture.pid.json'), 'utf8'));
assert.equal(fixtureMetadata.id, APP); assert.equal(fixtureMetadata.policy, 0, 'Fixture must be a regular discoverable application');
const token = randomBytes(32).toString('hex');
const free = createServer(); await new Promise<void>(r => free.listen(0, '127.0.0.1', r));
const gatewayPort = (free.address() as any).port; await new Promise<void>(r => free.close(() => r()));
await writeFile(join(root, 'xopc.json'), JSON.stringify({ computer: { enabled: true }, gateway: { port: gatewayPort, bind: 'loopback', auth: { mode: 'token', token } } }), { mode: 0o600 });
const env: NodeJS.ProcessEnv = { ...process.env, XOPC_HOME: root, XOPC_STATE_DIR: root, XOPC_WORKSPACE: join(root, 'workspace'),
  XOPC_CONFIG_PATH: join(root, 'xopc.json'), XOPC_CREDENTIALS_DIR: join(root, 'credentials'),
  XOPC_LOG_LEVEL: 'fatal', XOPC_LOG_FILE: 'false', XOPC_SQLITE_ASSET_ROOT: join(repo, 'src/storage/sqlite'), XOPC_FLOW_GATEWAY_TOKEN: token };
delete env.ELECTRON_RUN_AS_NODE;
const pause = () => new Promise(r => setTimeout(r, 50));
function child(file: string, args: string[], childEnv = env) {
  const proc = spawn(file, args, { cwd: repo, env: childEnv, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = ''; proc.stdout?.on('data', b => { output = (output + b).slice(-4000); }); proc.stderr?.on('data', b => { output = (output + b).slice(-4000); });
  const pending = new Map<string, { resolve(v: any): void; reject(e: Error): void }>();
  let readyResolve: () => void, readyReject: (e: Error) => void;
  const ready = new Promise<void>((r, j) => { readyResolve = r; readyReject = j; });
  const timer = setTimeout(() => readyReject(new Error(`Startup timed out: ${output}`)), 90_000);
  proc.on('message', (message: any) => {
    if (message.ready) { clearTimeout(timer); readyResolve(); return; }
    const waiter = pending.get(message.id); if (!waiter) return; pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error)) : waiter.resolve(message.value);
  });
  proc.on('exit', () => { clearTimeout(timer); readyReject(new Error(`Child exited: ${output}`)); for (const p of pending.values()) p.reject(new Error(`Child exited: ${output}`)); pending.clear(); });
  return { proc, ready, rpc: (op: string, fields: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
    if (!proc.connected) { reject(new Error('Validation child is disconnected')); return; }
    const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(new Error('Private validation IPC timed out')); }, 120_000);
    pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } }); proc.send({ id, op, ...fields }, error => { if (error) { clearTimeout(timer); pending.delete(id); reject(new Error('Validation IPC send failed')); } });
  }) };
}
const results: any[] = []; let flowId: string | undefined, principalId: string | undefined, previousEndpointId: string | undefined;
for (const phase of ['capture', 'reuse', 'unknown']) {
  console.log(`Running real Gateway / desktop network validation: ${phase}`);
  const bridge = createComputerFlowNetworkProxy(gatewayPort); await new Promise<void>(r => bridge.http.listen(0, '127.0.0.1', r));
  const proxyPort = (bridge.http.address() as any).port;
  const gateway = child(process.execPath, ['--import', 'tsx', join(repo, 'scripts/verify-computer-network-gateway.mts')]);
  let desktop: ReturnType<typeof child> | undefined;
  let verificationEvidence: unknown, windowEvidence: unknown;
  const evidenceFor = (value: any) => {
    let tree: any; try { tree = JSON.parse(value.summary); } catch { /* Metadata only. */ }
    return { verification: value.verification, roots: tree?.elements?.filter((e: any) => e.role === 'AXWindow').length,
      elements: tree?.elements?.length, textLength: tree?.text?.length, heading: tree?.text?.includes(EXPECT.text), truncated: tree?.truncated };
  };
  try {
    await gateway.ready;
    const base = `http://127.0.0.1:${proxyPort}`, headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const request = async (path: string, body?: unknown, method?: string) => {
      const response = await fetch(base + path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error' });
      assert.ok(response.ok, `Authenticated Gateway request failed: ${response.status}`); return response.json() as Promise<any>;
    };
    for (const path of ['/api/endpoint-tools/compatibility', '/api/endpoint-tools/devices']) assert.equal((await fetch(base + path)).status, 401);
    assert.equal((await fetch(base + '/api/realtime/tickets', { method: 'POST', headers: { ...headers, Authorization: 'Bearer invalid' }, body: '{}' })).status, 401);
    const badSocket = new WebSocket(`ws://127.0.0.1:${proxyPort}/api/realtime/v1/ws`);
    const rejectedTicket = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => { badSocket.terminate(); reject(new Error('Invalid ticket was not rejected')); }, 5000);
      badSocket.on('error', reject); badSocket.on('close', code => { clearTimeout(timer); resolve(code); });
      badSocket.on('open', () => badSocket.send(JSON.stringify({ protocolVersion: REALTIME_PROTOCOL_VERSION, messageId: randomUUID(),
        kind: 'realtime.hello', sentAt: Date.now(), payload: { ticket: randomBytes(32).toString('hex'), clientId: randomUUID(), clientKind: 'desktop', subscriptions: [] } })));
    });
    assert.equal(await rejectedTicket, 4401);
    const desktopEnv: NodeJS.ProcessEnv = { ...env, XOPC_FLOW_PROXY_PORT: String(proxyPort), XOPC_FLOW_FIXTURE_PID: String(fixturePid) };
    delete desktopEnv.DASHSCOPE_API_KEY; delete desktopEnv.QWEN_API_KEY;
    desktop = child(electron, [join(cache, 'desktop.mjs')], desktopEnv); await desktop.ready;
    let status: any; const deadline = Date.now() + 30_000;
    do { status = await gateway.rpc('status'); if (status.endpoints.length === 1) break; assert.ok(Date.now() < deadline, 'Signed desktop handshake timed out'); await pause(); } while (true);
    const endpoint = status.endpoints[0];
    if (principalId) { assert.equal(endpoint.principalId, principalId); assert.notEqual(endpoint.endpointId, previousEndpointId); }
    principalId = endpoint.principalId; previousEndpointId = endpoint.endpointId;
    const identity = JSON.parse(await readFile(join(root, 'electron/desktop-endpoint-identity.json'), 'utf8'));
    assert.equal(identity.principalId, endpoint.principalId); assert.ok(identity.encryptedPrivateKey && !identity.privateKey);
    const desktopStatus = await desktop.rpc('status'); assert.equal(desktopStatus.claim.endpointId, endpoint.endpointId);
    const upload = await fetch(base + `/api/endpoint-tools/invocations/${randomUUID()}/files?name=observation.png`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'image/png', 'x-endpoint-id': endpoint.endpointId, 'x-endpoint-upload-token': 'invalid' }, body: new Uint8Array([1]) });
    assert.equal(upload.status, 400); assert.equal((await upload.json() as any).error.code, 'INVALID_UPLOAD_GRANT');
    await request(`/api/endpoint-tools/bindings/${status.owner}`, { endpointId: endpoint.endpointId }, 'PUT');
    const execute = (input: unknown) => gateway.rpc('execute', { input });
    const settle = async (input: unknown) => {
      let value = await execute(input); const until = Date.now() + 30_000;
      while (['pending_action', 'pending_authorization'].includes(value.status)) {
        assert.ok(Date.now() < until); await pause(); value = await execute(value.status === 'pending_action' ? { op: 'step', goal: 'Resume the held action' } : { op: 'observe' });
      } return value;
    };
    const open = async () => {
      const apps = await execute({ op: 'discover', query: APP }); assert.equal(apps.apps.length, 1);
      const input = { op: 'open', appRef: apps.apps[0].appRef, mode: 'control', prepare: false };
      let value = await settle(input);
      if (value.windows) windowEvidence = value.windows.map((w: any) => ({ title: w.title, visible: w.visible }));
      if (value.errorCode === 'COMPUTER_WINDOW_AMBIGUOUS') {
        const candidates = value.windows.filter((w: any) => w.title === WINDOW);
        if (candidates.length === 1) { await desktop!.rpc('drained'); value = await settle({ ...input, windowRef: candidates[0].windowRef }); }
      }
      return value;
    };
    const baseline = async (first = false) => {
      await desktop!.rpc('mode', { mode: 'setup' }); assert.equal((await open()).status, 'ready'); await execute({ op: 'observe' });
      assert.equal((await desktop!.rpc('baseline', { owner: status.owner, requireSelected: first })).selected, true);
      await execute({ op: 'close' });
    };
    const flows = await execute({ op: 'flows' }); assert.equal(flows.flows.length, flowId ? 1 : 0); if (flowId) assert.equal(flows.flows[0].id, flowId);
    await desktop.rpc('access', { allowed: false }); assert.equal((await open()).errorCode, 'COMPUTER_APP_NOT_AUTHORIZED');
    const denied = await desktop.rpc('status'); assert.equal(denied.observations, 0); assert.equal(denied.inputs, 0); assert.equal((await gateway.rpc('status')).modelRequests, 0);
    await desktop.rpc('access', { allowed: true });
    await baseline(phase === 'capture'); await desktop.rpc('mode', { mode: 'scenario' });
    assert.equal((await open()).status, 'ready');
    const before = await desktop.rpc('status');
    if (phase === 'unknown') bridge.arm();
    const step = { op: 'step', goal: 'Open Navigation Page using exactly one native activate action with its ref from the current accessibility context. Do not use coordinate clicks, keys, typing, or other controls; request interaction if no native target is advertised.',
      expect: EXPECT, ...(flowId ? { flowId } : {}) };
    if (phase === 'unknown') {
      await assert.rejects(settle(step), /COMPUTER_DISPATCH_FAILED/);
      const s = await gateway.rpc('status'); assert.equal(s.report.failure.dispatch, 'unknown'); assert.equal(s.report.counters.unknownDispatches, 1);
      assert.equal(s.modelRequests, 1, 'No further model request after the one successful decision');
      assert.equal(s.report.counters.rescueAttempts, 0); assert.equal(s.report.status, 'released'); assert.equal(s.controlActive, false);
      assert.ok(bridge.state().lost && bridge.state().effect); assert.equal(bridge.counts.actAfterLoss, 0);
      assert.equal((await execute({ op: 'close', saveFlowAs: 'Unknown outcome' })).errorCode, 'COMPUTER_FLOW_NOT_VERIFIED');
    } else {
      const result = await settle(step); assert.equal(result.receipt?.dispatch, 'completed');
      verificationEvidence = evidenceFor(result);
      if (!result.verified) verificationEvidence = { first: verificationEvidence, readOnlyProbe: evidenceFor(await execute({ op: 'observe', expect: step.expect })) };
      assert.equal(result.verified, true);
      const closed = await execute({ op: 'close', ...(phase === 'capture' ? { saveFlowAs: 'Native network navigation' } : {}) });
      assert.equal(closed.status, 'stopped'); assert.ok(!closed.errorCode); if (phase === 'capture') { assert.ok(closed.savedFlow); flowId = closed.savedFlow.id; }
    }
    const after = await desktop.rpc('status'), actual = await gateway.rpc('status');
    assert.equal(after.inputs, 1); assert.ok(after.approvals.action - before.approvals.action >= 1 && after.approvals.action - before.approvals.action <= 2); assert.equal(after.pageObserved, true);
    assert.ok(actual.modelRequests >= 1 && actual.modelRequests <= 2); assert.equal(actual.hostedResponses, actual.modelRequests); assert.equal(actual.hintRequests, phase === 'capture' ? 0 : actual.modelRequests);
    assert.equal((await execute({ op: 'flows' })).flows.length, 1);
    assert.equal(actual.retainedFrames, 0); assert.equal((await readdir(join(root, 'endpoint-tool-files'))).length, 0);
    assert.ok(bridge.counts.registrations >= 1 && bridge.counts.tickets >= 1 && bridge.counts.hellos >= 1 && bridge.counts.uploads >= 2);
    await baseline(); await desktop.rpc('access', { allowed: false });
    const final = await desktop.rpc('status'); assert.equal(final.cleanupInputs, 1);
    const evidence = { phase, app: APP, window: WINDOW, gatewayPid: gateway.proc.pid, desktopPid: desktop.proc.pid, status: 'passed', restarted: phase !== 'capture',
      samePrincipalAfterRestart: phase !== 'capture', freshEndpointAfterRestart: phase !== 'capture', flowIdPreserved: phase !== 'capture',
      unauthorizedHttpRejected: true, invalidRealtimeTicketRejected: true, osEncryptedIdentity: true, modelCredentialOnlyInGateway: true, invalidUploadGrantRejected: true, deniedWithoutAppAccess: true, framesReleasedWithoutDiskFiles: true, scenarioNativeInputs: after.inputs,
      modelRequests: actual.modelRequests, hostedResponses: actual.hostedResponses, hintRequests: actual.hintRequests,
      localSessionChecks: final.approvals.session, localActionChecks: final.approvals.action, network: bridge.counts,
      realEffectBeforeLostReply: bridge.state().effect, failureDispatch: actual.report.failure?.dispatch ?? null,
      rescueAttempts: actual.report.counters.rescueAttempts, releaseStatus: actual.report.status, cleanupInputs: final.cleanupInputs, baselineRestored: true };
    await writeFile(join(root, `${phase}-result.json`), JSON.stringify(evidence, null, 2), { mode: 0o600 }); results.push(evidence);
    await desktop.rpc('stop'); await gateway.rpc('stop');
  } catch (error) {
    const gatewayState = await gateway.rpc('status').catch(() => undefined), desktopState = await desktop?.rpc('status').catch(() => undefined);
    // Keep only metadata; never persist tokens, identities, raw observations or model text.
    await writeFile(join(root, `${phase}-failure.json`), JSON.stringify({ phase, modelRequests: gatewayState?.modelRequests,
      windowEvidence, verificationEvidence, lastError: gatewayState?.lastError, report: gatewayState?.report, inputs: desktopState?.inputs, observations: desktopState?.observations, network: bridge.counts }, null, 2), { mode: 0o600 });
    throw new Error(`${phase} failed; no phase is retried. Evidence: ${root}. ${error instanceof Error ? error.message : 'Validation failed'}`);
  } finally {
    desktop?.proc.kill(); gateway.proc.kill(); await bridge.close();
  }
}
assert.equal(new Set(results.map(r => r.gatewayPid)).size, 3); assert.equal(new Set(results.map(r => r.desktopPid)).size, 3);
assert.equal(new Set(results.flatMap(r => [r.gatewayPid, r.desktopPid])).size, 6);
fixture.kill();
console.log(JSON.stringify({ status: 'passed', evidenceDirectory: root, independentGatewayProcesses: 3, independentDesktopProcesses: 3, nativeAppPid: fixturePid, modelRef: 'dashscope-cn/gui-plus-2026-02-26', results }, null, 2));
