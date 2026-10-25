/** Opt-in Windows fault injection and native application matrix. No CI or publishing changes. */
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { windowsAppIdentity } from '../electron/computer/windows-apps.js';
import { summarizeComputerTimings } from './lib/computer-performance.mjs';
const { WebSocket, WebSocketServer } = createRequire(import.meta.url)('ws') as typeof import('ws');
assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
const matrixOnly = process.argv.includes('--matrix-only'), networkOnly = process.argv.includes('--network-only');
assert.ok(!(matrixOnly && networkOnly), 'Choose only one validation subset');
const repo = resolve(import.meta.dirname, '..'), root = join(repo, '.cache', `windows-reliability-${randomUUID()}`);
await mkdir(join(root, 'state'), { recursive: true }); await mkdir(join(root, 'electron'));
const fixturePath = join(root, `XopcInputFixture-${randomUUID().slice(0, 8)}.exe`), oraclePath = join(root, 'fixture.json');
const ps = join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const compile = join(root, 'compile.ps1');
await writeFile(compile, "$ErrorActionPreference='Stop'; Add-Type -Path $args[0] -OutputAssembly $args[1] -OutputType WindowsApplication -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions");
const compiled = spawnSync(ps, ['-NoProfile', '-File', compile, join(repo, 'scripts/computer-input-fixture.cs'), fixturePath], { windowsHide: true, encoding: 'utf8', timeout: 30_000 });
assert.equal(compiled.status, 0, compiled.stderr);
const fixture = spawn(fixturePath, [oraclePath], { stdio: 'ignore' });
const free = createServer(); await new Promise<void>(r => free.listen(0, '127.0.0.1', r));
const port = (free.address() as any).port; await new Promise<void>(r => free.close(() => r()));
const token = randomBytes(32).toString('hex');
await writeFile(join(root, 'state/xopc.json'), JSON.stringify({ computer: { enabled: true }, gateway: { port, bind: 'loopback', auth: { mode: 'token', token } } }));
const env = { ...process.env, XOPC_STATE_DIR: join(root, 'state'), XOPC_CONFIG_PATH: join(root, 'state/xopc.json'),
  XOPC_SQLITE_ASSET_ROOT: join(repo, 'src/storage/sqlite'), XOPC_LOG_LEVEL: 'fatal', XOPC_LOG_FILE: 'false', XOPC_RELIABILITY_ROOT: root,
  XOPC_RELIABILITY_FIXTURE: fixturePath, XOPC_RELIABILITY_TOKEN: token, XOPC_RELIABILITY_BINARY: join(repo, '.cache/computer-driver/0.36.0/win32-x64/cua-driver.exe') };
delete env.ELECTRON_RUN_AS_NODE;
function child(file: string, args: string[], extra: Record<string, string> = {}) {
  const proc = spawn(file, args, { cwd: repo, env: { ...env, ...extra }, windowsHide: file === process.execPath, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = ''; proc.stdout?.on('data', b => { output = (output + b).slice(-3000); }); proc.stderr?.on('data', b => { output = (output + b).slice(-3000); });
  const pending = new Map<string, { resolve(v: any): void; reject(e: Error): void }>();
  let readyResolve: () => void, readyReject: (e: Error) => void;
  const ready = new Promise<void>((r, j) => { readyResolve = r; readyReject = j; });
  const startup = setTimeout(() => readyReject(new Error(`Worker startup timeout: ${output}`)), 150_000);
  proc.on('message', (m: any) => { if (m.progress) { console.log(JSON.stringify(m.progress)); return; } if (m.ready) { clearTimeout(startup); readyResolve(); } else { const waiter = pending.get(m.id); pending.delete(m.id); m.error ? waiter?.reject(new Error(m.error)) : waiter?.resolve(m.value); } });
  proc.on('exit', () => { clearTimeout(startup); readyReject(new Error(`Worker exited: ${output}`)); for (const waiter of pending.values()) waiter.reject(new Error(`Worker exited: ${output}`)); });
  return { proc, ready, rpc: (op: string, fields: any = {}) => new Promise<any>((resolve, reject) => {
    const id = randomUUID(); const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Worker ${op} timeout`)); }, op === 'matrix' ? 600_000 : 60_000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    proc.send({ id, op, ...fields }, error => { if (error) pending.get(id)?.reject(error); });
  }) };
}
let fault: 'none' | 'disconnect' | 'lost-result' = 'none';
const calls = new Map<string, string>(); const sockets = new Set<import('ws').WebSocket>();
const counts = { uploads: 0, invocations: 0, droppedResults: 0, reconnects: 0 };
const proxy = createServer((req, res) => {
  const upstream = httpRequest({ hostname: '127.0.0.1', port, method: req.method, path: req.url, headers: req.headers }, answer => {
    if (answer.statusCode === 200 && req.url?.includes('/files?')) counts.uploads++;
    res.writeHead(answer.statusCode!, answer.headers); answer.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
});
const ws = new WebSocketServer({ server: proxy, path: '/api/realtime/v1/ws' });
ws.on('connection', downstream => {
  counts.reconnects++; const upstream = new WebSocket(`ws://127.0.0.1:${port}/api/realtime/v1/ws`); sockets.add(downstream); sockets.add(upstream);
  const queue: Buffer[] = [];
  upstream.on('open', () => { for (const bytes of queue.splice(0)) upstream.send(bytes, { binary: false }); });
  downstream.on('message', data => {
    const bytes = Buffer.from(data as any), outer = JSON.parse(bytes.toString()), message = outer.kind === 'endpoint.message' ? outer.payload : undefined;
    if (fault === 'lost-result' && message?.type === 'tool.result' && calls.get(message.payload.invocationId) === 'act') {
      const value = message.payload.content.find((c: any) => c.type === 'json')?.value;
      if (value?.receipt?.dispatch === 'completed') { fault = 'none'; counts.droppedResults++; downstream.terminate(); upstream.terminate(); return; }
    }
    if (upstream.readyState === WebSocket.OPEN) upstream.send(bytes, { binary: false }); else queue.push(bytes);
  });
  upstream.on('message', data => {
    const outer = JSON.parse(data.toString()), message = outer.kind === 'endpoint.message' ? outer.payload : undefined;
    if (message?.type === 'tool.invoke') { counts.invocations++; calls.set(message.payload.invocationId, message.payload.arguments.op); }
    if (downstream.readyState === WebSocket.OPEN) downstream.send(data, { binary: false });
  });
  downstream.on('close', () => { sockets.delete(downstream); upstream.terminate(); }); upstream.on('close', () => { sockets.delete(upstream); downstream.terminate(); });
  downstream.on('error', () => upstream.terminate()); upstream.on('error', () => downstream.terminate());
});
await new Promise<void>(r => proxy.listen(0, '127.0.0.1', r));
const proxyPort = (proxy.address() as any).port;
await build({ entryPoints: [join(repo, 'scripts/verify-windows-reliability-desktop.mts')], outfile: join(root, 'desktop.mjs'), bundle: true,
  platform: 'node', format: 'esm', external: ['electron', '@trycua/cua-driver', '@earendil-works/*', 'sharp', 'better-sqlite3'],
  banner: { js: 'import { createRequire as __makeRequire } from "node:module"; const require = __makeRequire(import.meta.url);' } });
let gateway = matrixOnly ? undefined : child(process.execPath, ['--import', 'tsx', join(repo, 'scripts/verify-windows-reliability-gateway.mts')]);
let desktop: ReturnType<typeof child> | undefined, notepad: ChildProcess | undefined, wpf: ChildProcess | undefined;
const evidence: any = { passed: false, startedAt: new Date().toISOString(), faults: [], scope: 'real Windows x64 Cua, production Gateway HTTP/WS and DesktopEndpointHost; deterministic inputs, no model' };
async function waitFor<T>(probe: () => Promise<T>, predicate: (value: T) => boolean, label: string, timeout = 30_000): Promise<T> {
  const end = Date.now() + timeout;
  while (true) { const value = await probe(); if (predicate(value)) return value; assert.ok(Date.now() < end, label); await delay(100); }
}
try {
  if (gateway) await gateway.ready;
  await waitFor(async () => readFile(oraclePath, 'utf8').then(JSON.parse, () => undefined), s => s?.pid === fixture.pid, 'Fixture did not start');
  desktop = child(createRequire(import.meta.url)('electron') as string, [join(root, 'desktop.mjs')], { XOPC_RELIABILITY_PROXY_PORT: String(proxyPort), XOPC_RELIABILITY_MATRIX_ONLY: String(matrixOnly) }); await desktop.ready;
  if (!matrixOnly) {
  await waitFor(() => desktop!.rpc('status'), s => s.connected, 'Desktop handshake did not complete'); await desktop.rpc('access');
  const owner = randomUUID(); let sessionId = randomUUID(), endpointId = '', current: any;
  const refreshEndpoint = async () => { const s = await waitFor(() => gateway.rpc('status'), s => s.endpoints.length === 1, 'No desktop endpoint'); endpointId = s.endpoints[0].endpointId; };
  const invoke = async (command: any) => { const json = await gateway.rpc('invoke', { endpointId, command: { ...command, owner, sessionId } }); return json.value; };
  const open = async () => {
    await refreshEndpoint(); sessionId = randomUUID();
    const apps = await invoke({ op: 'discover', query: basename(fixturePath) }); assert.equal(apps.apps.length, 1);
    await invoke({ op: 'open', appRef: apps.apps[0].appRef, mode: 'control', prepare: false,
      model: { modelRef: 'validation/deterministic', profile: 'structured-tools-v1', origin: 'https://validation.invalid', runtimeLocation: 'local' } });
    await waitFor(() => invoke({ op: 'status' }), s => s.status !== 'pending_authorization', 'Native open timed out');
    current = await invoke({ op: 'observe' }); assert.ok(current.observation);
  };
  const action = () => {
    const field = JSON.parse(current.observation.summary).elements.filter((e: any) => e.label === 'Message' && e.inputAllowed); assert.equal(field.length, 1);
    return { op: 'act', envelope: { actionId: randomUUID(), sessionId, observationId: current.observation.id, brokerEpoch: current.brokerEpoch,
      generation: current.generation, grantId: current.grantId, deadlineAt: Date.now() + 30_000, action: { kind: 'setValue', ref: field[0].ref, text: 'Lost result applied once' } } };
  };
  await open();
  console.log('Fault: lose a completed native input result and disconnect');
  const command = action(); await invoke(command); fault = 'lost-result';
  await assert.rejects(async () => { while (true) { const result = await invoke(command); if (result.status !== 'pending_action') return; await delay(20); } });
  await waitFor(() => desktop!.rpc('status'), s => s.session.status === 'stopped', 'Disconnect failed to revoke control');
  const once = (await desktop.rpc('status')).nativeInputs; assert.equal(once, 1);
  assert.equal(JSON.parse(await readFile(oraclePath, 'utf8')).text, 'Lost result applied once');
  await delay(500); assert.equal((await desktop.rpc('status')).nativeInputs, once);
  await desktop.rpc('drain');
  evidence.faults.push({ name: 'lost-completed-result', passed: true, nativeInputs: once, noReplay: true });
  await open();
  console.log('Fault: terminate only the owned Cua driver');
  await desktop.rpc('crashDriver');
  await assert.rejects(() => invoke({ op: 'observe' }));
  assert.equal((await desktop.rpc('status')).session.status, 'stopped', 'Crash must revoke the old grant immediately');
  await desktop.rpc('drain');
  assert.equal((await desktop.rpc('status')).nativeInputs, once);
  evidence.faults.push({ name: 'driver-crash', passed: true, noAdditionalInputs: true });
  await open();
  console.log('Fault: hide the local control UI');
  await desktop.rpc('visibility', { visible: false });
  await waitFor(() => desktop!.rpc('status'), s => s.session.status === 'stopped', 'Hidden UI failed to revoke control');
  await assert.rejects(() => invoke(action()));
  await desktop.rpc('visibility', { visible: true });
  await desktop.rpc('drain');
  evidence.faults.push({ name: 'hidden-control-ui', passed: true, noAdditionalInputs: true });
  await open();
  console.log('Fault: restart the real Gateway');
  const principal = (await gateway.rpc('status')).endpoints[0].principalId;
  await new Promise<void>(resolve => { gateway.proc.once('exit', () => resolve()); gateway.proc.kill(); });
  await waitFor(() => desktop!.rpc('status'), s => s.session.status === 'stopped', 'Gateway stop failed to revoke control');
  gateway = child(process.execPath, ['--import', 'tsx', join(repo, 'scripts/verify-windows-reliability-gateway.mts')]); await gateway.ready;
  await refreshEndpoint(); assert.equal((await gateway.rpc('status')).endpoints[0].principalId, principal);
  assert.equal((await desktop.rpc('status')).nativeInputs, once);
  evidence.faults.push({ name: 'gateway-restart', mode: 'abrupt-process-exit', passed: true, principalRetained: true, noReplay: true });
  }
  evidence.matrix = [];
  if (!networkOnly) {
  const matrix: any[] = [{ name: 'WinForms native fixture', appId: windowsAppIdentity({ bundleId: fixturePath, name: '', pid: 0, running: true, active: false })!.appId,
    query: basename(fixturePath), prepare: false, oracle: oraclePath, repetitions: 3 }];
  const wpfPath = join(root, 'XopcWpfFixture.exe'), wpfOracle = join(root, 'wpf.json'), wpfCompile = join(root, 'compile-wpf.ps1');
  await writeFile(wpfCompile, "$ErrorActionPreference='Stop'; $wpf=Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/WPF'; Add-Type -Path $args[0] -OutputAssembly $args[1] -OutputType WindowsApplication -ReferencedAssemblies @('System.Web.Extensions',(Join-Path $wpf 'PresentationFramework.dll'),(Join-Path $wpf 'PresentationCore.dll'),(Join-Path $wpf 'WindowsBase.dll'),'System.Xaml')");
  const wpfBuilt = spawnSync(ps, ['-NoProfile', '-File', wpfCompile, join(repo, 'scripts/computer-wpf-fixture.cs'), wpfPath], { windowsHide: true, encoding: 'utf8', timeout: 30_000 });
  assert.equal(wpfBuilt.status, 0, wpfBuilt.stderr); wpf = spawn(wpfPath, [wpfOracle], { stdio: 'ignore' });
  await waitFor(async () => readFile(wpfOracle, 'utf8').then(JSON.parse, () => undefined), s => s?.pid === wpf?.pid, 'WPF fixture did not start');
  matrix.push({ name: 'WPF native fixture', appId: windowsAppIdentity({ bundleId: wpfPath, name: '', pid: 0, running: true, active: false })!.appId,
    query: 'XopcWpfFixture', prepare: true, oracle: wpfOracle, repetitions: 3 });
  // Do not open or modify existing personal Calculator/Notepad windows.
  const inventory = spawnSync(ps, ['-NoProfile', '-Command', "@(Get-Process CalculatorApp,Calculator,notepad -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName) | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true });
  const names = inventory.stdout.toLowerCase();
  const calc = windowsAppIdentity({ bundleId: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe', launchPath: 'shell:appsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App', kind: 'uwp', name: 'Calculator', pid: 0, running: false, active: false })!;
  matrix.push({ name: 'Windows Calculator', appId: calc.appId, query: 'Calculator', kind: 'calculator', prepare: true, ...(names.includes('calculator') ? { skip: 'Existing Calculator window left untouched' } : {}) });
  if (names.includes('notepad')) matrix.push({ name: 'Windows Notepad', skip: 'Existing Notepad window left untouched' });
  else {
    const document = join(root, 'notepad-validation.txt'); await writeFile(document, 'Replace this disposable sample');
    notepad = spawn(join(process.env.SystemRoot!, 'System32/notepad.exe'), [document], { stdio: 'ignore' }); await delay(2000);
    // Resolve the actual installed app ID in the desktop worker, not from a guessed executable path.
    const access = await desktop.rpc('access'); const matches = access.apps.filter((a: any) => /notepad|记事本/i.test(a.name) && a.running);
    matrix.push(matches.length === 1 ? { name: 'Windows Notepad', appId: matches[0].appId, query: matches[0].name, prepare: true, document }
      : { name: 'Windows Notepad', skip: 'Notepad was unavailable or ambiguous' });
  }
  const appFilter = process.argv.find(arg => arg.startsWith('--app='))?.slice(6).toLowerCase();
  const selectedMatrix = appFilter ? matrix.filter(spec => spec.name.toLowerCase().includes(appFilter)) : matrix;
  assert.ok(selectedMatrix.length, 'Application filter did not match the matrix');
  await writeFile(join(root, 'matrix.json'), JSON.stringify(selectedMatrix));
  console.log('Running native application matrix and phase timings');
  evidence.matrix = await desktop.rpc('matrix');
  }
  evidence.network = counts;
  evidence.desktop = { nativeInputs: (await desktop.rpc('status')).nativeInputs, timings: (await desktop.rpc('status')).timings };
  evidence.phaseSummary = summarizeComputerTimings(evidence.desktop.timings);
  for (const row of evidence.matrix) if (row.timings) {
    row.phaseSummary = summarizeComputerTimings(row.timings);
    row.unattributedMs = Math.max(0, row.wallMs - row.timings.reduce((sum: number, sample: any) => sum + sample.ms, 0));
  }
  evidence.passed = evidence.matrix.every((row: any) => row.outcome !== 'failed');
} catch (error) { evidence.failure = error instanceof Error ? error.message : String(error); throw error; }
finally {
  if (desktop?.proc.connected) await desktop.rpc('stop').catch(() => {
    if (desktop?.proc.pid) spawnSync('taskkill', ['/PID', String(desktop.proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  });
  if (gateway?.proc.connected) await gateway.rpc('stop').catch(() => { gateway?.proc.kill(); });
  fixture.kill(); notepad?.kill(); wpf?.kill();
  // Store Notepad may hand the document to a different PID. Only close a process
  // whose session payload contains this run's unique disposable document path.
  const cleanupScript = join(repo, 'scripts/cleanup-windows-validation-notepad.ps1');
  const cleanup = spawnSync(ps, ['-NoProfile', '-File', cleanupScript, root], { windowsHide: true, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, PSModulePath: join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/Modules') } });
  evidence.notepadCleanupChecked = cleanup.status === 0;
  for (const socket of sockets) socket.terminate(); ws.close(); await new Promise<void>(r => proxy.close(() => r()));
  evidence.finishedAt = new Date().toISOString(); await writeFile(join(root, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(`Windows reliability evidence: ${join(root, 'result.json')}`);
}
assert.equal(evidence.passed, true, 'Application matrix contains failures; see evidence');
