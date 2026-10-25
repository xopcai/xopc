/** Opt-in NSIS installation -> normal app -> Gateway session -> real cloud model -> Windows UIA. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { release } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { resolveCredentialsDir } from '../src/config/paths.js';
import { getModelCatalogStore } from '../src/providers/model-catalog-store.js';
import { ModelCatalogPersistence } from '../src/providers/model-catalog-persistence.js';
import { REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';

const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');
const { WebSocket } = createRequire(import.meta.url)('ws') as typeof import('ws');

assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
const repo = resolve(import.meta.dirname, '..');
const installer = resolve(process.argv[2] ?? join(repo, 'dist/release/xopc-0.0.416-x64.exe'));
assert.ok(existsSync(installer), 'Build a fresh NSIS installer first');
const output = join(repo, '.cache', `installed-windows-${randomUUID()}`);
await mkdir(output, { recursive: true });
const root = join(output, 'state'), userData = join(output, 'electron'), installDir = join(output, 'app');
await mkdir(root); await mkdir(userData);
const ps = join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const runPs = (code: string) => spawnSync(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', code], {
  env: { ...process.env, PSModulePath: join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/Modules') },
  encoding: 'utf8', windowsHide: true, timeout: 30_000,
});
// A production NSIS identity can replace an existing install. Refuse before any mutation.
const preflight = runPs("$ErrorActionPreference='Stop'; $installed=@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object DisplayName -EQ 'xopc'); if ($installed.Count -gt 0 -or (Get-Process xopc -ErrorAction SilentlyContinue)) { exit 9 }");
assert.equal(preflight.status, 0, 'Use a clean Windows account: xopc is already installed or running');
const protocolKey = 'HKCU\\Software\\Classes\\xopc';
const protocolBackup = join(output, 'protocol-before.reg');
const hadProtocol = spawnSync('reg.exe', ['query', protocolKey], { stdio: 'ignore', windowsHide: true }).status === 0;
if (hadProtocol) assert.equal(spawnSync('reg.exe', ['export', protocolKey, protocolBackup, '/y'], { stdio: 'ignore', windowsHide: true }).status, 0);
async function port() { const server = createServer(); await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const value = (server.address() as any).port; await new Promise<void>(r => server.close(() => r())); return value as number; }
const gatewayPort = await port(), debugPort = await port(), token = randomBytes(32).toString('hex');
const base = `http://127.0.0.1:${gatewayPort}`;
const env = { ...process.env, XOPC_STATE_DIR: root, XOPC_CONFIG_PATH: join(root, 'xopc.json'),
  XOPC_WORKSPACE: join(root, 'workspace'), XOPC_CREDENTIALS_DIR: resolveCredentialsDir(),
  XOPC_ELECTRON_USER_DATA_DIR: userData, XOPC_LOG_LEVEL: 'debug', XOPC_LOG_CONSOLE: 'false',
  XOPC_UPDATE_FEED_URL: 'https://updates.invalid.example/installed-validation' };
delete env.ELECTRON_RUN_AS_NODE;
await writeFile(join(root, 'xopc.json'), JSON.stringify({ computer: { enabled: true, maxModelRequests: 14, maxActionsPerSession: 12 },
  gateway: { port: gatewayPort, bind: 'loopback', auth: { mode: 'token', token } } }));
const source = getModelCatalogStore().getSource('xopc-cloud'); assert.ok(source);
await new ModelCatalogPersistence(join(root, 'cache/model-catalog/xopc-cloud-v1.json')).save(source);
const seed = spawnSync(process.execPath, ['--import', 'tsx', join(repo, 'scripts/prepare-computer-windows-installed.mts')],
  { cwd: repo, env: { ...env, XOPC_SQLITE_ASSET_ROOT: join(repo, 'src/storage/sqlite') }, encoding: 'utf8', timeout: 60_000, windowsHide: true });
assert.equal(seed.status, 0, seed.stderr);
const fixturePath = join(output, 'XopcInputFixture.exe'), oraclePath = join(output, 'fixture-state.json');
const compile = join(output, 'compile.ps1');
await writeFile(compile, "$ErrorActionPreference='Stop'; Add-Type -Path $args[0] -OutputAssembly $args[1] -OutputType WindowsApplication -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions");
const compiled = spawnSync(ps, ['-NoProfile', '-File', compile, join(repo, 'scripts/computer-input-fixture.cs'), fixturePath], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
assert.equal(compiled.status, 0, compiled.stderr);
let installed = false, desktop: ReturnType<typeof spawn> | undefined, fixture: ReturnType<typeof spawn> | undefined;
let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
let conversationId: string | undefined;
const evidence: any = { passed: false, startedAt: new Date().toISOString(), windowsBuild: release(), arch: process.arch,
  scope: 'production NSIS; normal installed main and bundled Gateway; authenticated session input; real cloud chat and computer models; disposable native fixture',
  validationScriptSha256: createHash('sha256').update(await readFile(import.meta.filename)).digest('hex'),
  installerSha256: createHash('sha256').update(await readFile(installer)).digest('hex') };
async function request(path: string, body?: unknown, method?: string) {
  const response = await fetch(base + path, { method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  const data = await response.json() as any;
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(data).slice(0, 700)}`); return data;
}
try {
  console.log(`Installing production NSIS into disposable directory: ${output}`);
  const install = spawnSync(installer, ['/S', '--no-startup', `/D=${installDir}`], { env, windowsHide: true, timeout: 180_000 });
  assert.equal(install.status, 0, install.error?.message); installed = true;
  const executable = join(installDir, 'xopc.exe'); assert.ok(existsSync(executable));
  const required = ['cua-driver.exe', 'cua-driver-uia.exe', 'cua_driver_sdk.dll', 'cua_driver_node_runtime.node'];
  evidence.resources = await Promise.all(required.map(async name => {
    const bytes = await readFile(join(installDir, 'resources/bin', name)); return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }));
  evidence.installedAsarSha256 = createHash('sha256').update(await readFile(join(installDir, 'resources/app.asar'))).digest('hex');
  const stagedAsarHash = createHash('sha256').update(await readFile(join(repo, 'dist/release/win-unpacked/resources/app.asar'))).digest('hex');
  assert.equal(evidence.installedAsarSha256, stagedAsarHash, 'NSIS must install the exact staged application');
  const layout = spawnSync(process.execPath, [join(repo, 'scripts/verify-electron-asar-deps.mjs'), join(installDir, 'resources/app.asar')],
    { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  assert.equal(layout.status, 0, layout.stderr); evidence.installedRuntimeLayoutVerified = true;
  const signature = runPs(`$ErrorActionPreference='Stop'; (Get-AuthenticodeSignature -LiteralPath '${installer.replaceAll("'", "''")}').Status.ToString()`);
  assert.equal(signature.status, 0, signature.stderr);
  assert.match(signature.stdout.trim(), /^(Valid|NotSigned|HashMismatch|NotTrusted|UnknownError|NotSupported|Incompatible)$/);
  evidence.authenticode = signature.stdout.trim();
  fixture = spawn(fixturePath, [oraclePath], { stdio: 'ignore' });
  desktop = spawn(executable, [`--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1'], { cwd: installDir, env, stdio: 'ignore' });
  const until = Date.now() + 180_000;
  while (!browser) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 2000 }); }
    catch { assert.ok(Date.now() < until, 'Installed desktop CDP did not start'); await delay(500); }
  }
  let page: any;
  while (!page) {
    for (const candidate of browser.contexts().flatMap(c => c.pages())) {
      if (await candidate.evaluate(async () => {
        try { return !!await (window as any).electronAPI?.computer.status(); } catch { return false; }
      }).catch(() => false)) { page = candidate; break; }
    }
    assert.ok(Date.now() < until, 'Installed preload did not load'); if (!page) await delay(500);
  }
  let status: any;
  do { status = await page.evaluate(() => (window as any).electronAPI.computer.status()); if (status?.connected) break;
    assert.ok(Date.now() < until, `Installed desktop handshake timed out: ${status?.error}`); await delay(500);
  } while (true);
  evidence.endpoint = { platform: status.platform, capabilities: status.capabilities, connected: status.connected };
  const startupLog = await readFile(join(userData, 'electron-startup.log'), 'utf8');
  evidence.installedElectron = startupLog.match(/packaged=true electron=([\d.]+)/)?.[1];
  assert.ok(evidence.installedElectron, 'Must run a packaged Electron app');
  assert.equal(status.platform, 'win32'); assert.equal(status.capabilities.textInput, true);
  const identity = JSON.parse(await readFile(join(userData, 'desktop-endpoint-identity.json'), 'utf8'));
  assert.ok(identity.encryptedPrivateKey && !identity.privateKey); evidence.encryptedIdentity = true;
  for (const path of ['/api/endpoint-tools/compatibility', '/api/endpoint-tools/devices']) assert.equal((await fetch(base + path)).status, 401);
  evidence.unauthenticatedRejected = true;
  const badSocket = new WebSocket(`ws://127.0.0.1:${gatewayPort}/api/realtime/v1/ws`);
  const rejectedTicket = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => { badSocket.terminate(); reject(new Error('Invalid realtime ticket was not rejected')); }, 5000);
    badSocket.on('error', error => { clearTimeout(timer); reject(error); });
    badSocket.on('close', code => { clearTimeout(timer); resolve(code); });
    badSocket.on('open', () => badSocket.send(JSON.stringify({ protocolVersion: REALTIME_PROTOCOL_VERSION,
      messageId: randomUUID(), kind: 'realtime.hello', sentAt: Date.now(), payload: {
        ticket: randomBytes(32).toString('hex'), clientId: randomUUID(), clientKind: 'desktop', subscriptions: [],
      } })));
  });
  assert.equal(rejectedTicket, 4401); evidence.invalidRealtimeTicketRejected = true;
  const devices = await request('/api/endpoint-tools/devices');
  assert.ok(devices.payload.some((d: any) => d.endpoints.some((e: any) => e.endpointId === status.claim.endpointId)));
  const badUpload = await fetch(base + `/api/endpoint-tools/invocations/${randomUUID()}/files?name=observation.png`, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png', 'x-endpoint-id': status.claim.endpointId, 'x-endpoint-upload-token': 'invalid' }, body: new Uint8Array(2 * 1024 * 1024) });
  assert.equal(badUpload.status, 400); assert.equal((await badUpload.json() as any).error.code, 'INVALID_UPLOAD_GRANT'); evidence.invalidUploadRejected = true;
  const access = await page.evaluate(() => (window as any).electronAPI.computer.access());
  assert.equal(access.allowAllApps, false);
  const apps = access.apps.filter((a: any) => a.name.includes('XopcInputFixture')); assert.equal(apps.length, 1);
  await page.evaluate((id: string) => (window as any).electronAPI.computer.setAppAccess(id, true), apps[0].appId);
  conversationId = randomUUID();
  const prompt = 'Run this authorized disposable Windows GUI test now. Use only computer_use and tool_manual. Read the computer_use manual, discover XopcInputFixture, then open its existing window in control mode with prepare:false. In Message enter exactly "Windows 输入验证 OK", press End once while Message is focused, then click Verify exactly once. Do not touch Protected input, Read only, other apps, or terminals. Use computer_use run with expect {kind:"text",text:"PASS: Windows input verified"}. If a budget yields, continue the same goal without repeating completed actions. After positive verification, call report, then close. Finish with the verified result.';
  console.log('Installed app connected; submitting real authenticated Gateway session input');
  const accepted = await request(`/api/sessions/${conversationId}/inputs`, { kind: 'start', clientMessageId: randomUUID(),
    creation: { agentId: 'installed-validation', projectId: null, execution: null, temporary: false, model: 'xopc-cloud/auto', thinkingLevel: 'low' },
    origin: { type: 'endpoint', ...status.claim }, input: { content: prompt } });
  evidence.inputAccepted = accepted.ok === true;
  const deadline = Date.now() + 480_000;
  let oracle: any, lastProgress = Date.now();
  while (true) {
    oracle = JSON.parse(await readFile(oraclePath, 'utf8'));
    assert.equal(oracle.pid, fixture.pid); assert.equal(oracle.protectedLength, 0); assert.equal(oracle.readOnlyText, 'READ ONLY'); assert.ok(oracle.verifyClicks <= 1, 'No duplicate Verify click');
    const inputState = await request(`/api/sessions/${conversationId}/input-state`);
    if (Date.now() - lastProgress > 15_000) { console.log(JSON.stringify({ phase: 'installed-model-progress', validated: oracle.validated, verifyClicks: oracle.verifyClicks, running: !!inputState.payload?.activeRunId, inputStatus: inputState.payload?.inputs?.at(-1)?.status })); lastProgress = Date.now(); }
    if (oracle.validated) {
      const local = await page.evaluate(() => (window as any).electronAPI.computer.status());
      if (['idle', 'stopped'].includes(local.session?.status) && !inputState.payload?.activeRunId) break;
    }
    assert.ok(Date.now() < deadline, `Installed real-model flow timed out; oracle=${JSON.stringify(oracle)}`); await delay(1500);
  }
  await delay(1500);
  const transcript = await request(`/api/sessions/${conversationId}?include=transcriptRows,transcript`);
  await writeFile(join(output, 'synthetic-transcript.json'), JSON.stringify(transcript, null, 2));
  evidence.oracle = oracle;
  const serialized = JSON.stringify(transcript);
  assert.ok(serialized.includes('computer_use')); assert.ok(serialized.includes('PASS: Windows input verified'));
  evidence.gatewayTranscriptVerified = true;
  const reports: any[] = [];
  function collect(value: any): void {
    if (typeof value === 'string') { if (value.startsWith('{') && value.length < 200_000) { try { collect(JSON.parse(value)); } catch {} } return; }
    if (!value || typeof value !== 'object') return;
    if (value.version === 1 && value.counters?.modelRequests !== undefined && Array.isArray(value.recentActions)) reports.push(value);
    for (const child of Object.values(value)) collect(child);
  }
  collect(transcript);
  const report = reports.sort((a, b) => b.counters.completedInputs - a.counters.completedInputs || b.durationMs - a.durationMs)[0];
  assert.ok(report?.counters.modelRequests > 0, 'Transcript must contain a real Computer Use model report');
  assert.ok(report.counters.verifiedConditions > 0); assert.equal(report.counters.unknownDispatches, 0);
  assert.equal(report.status, 'released', 'Model must close the completed session');
  evidence.computerReport = report;
  // Reconnect the actual installed main and bundled Gateway, retaining only this test's data.
  await browser.close(); browser = undefined;
  spawnSync('taskkill', ['/PID', String(desktop.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  await delay(1000);
  desktop = spawn(executable, [`--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1'], { cwd: installDir, env, stdio: 'ignore' });
  const reconnectUntil = Date.now() + 120_000;
  let reconnected: any;
  while (!reconnected) {
    try {
      browser ??= await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 2000 });
      for (const candidate of browser.contexts().flatMap(c => c.pages())) {
        const next = await candidate.evaluate(() => (window as any).electronAPI.computer.status()).catch(() => undefined);
        if (next?.connected) { page = candidate; reconnected = next; break; }
      }
    } catch { /* Startup navigation or endpoint registration is still pending. */ }
    assert.ok(Date.now() < reconnectUntil, 'Installed app did not reconnect after restart');
    if (!reconnected) await delay(500);
  }
  assert.notEqual(reconnected.claim.endpointId, status.claim.endpointId);
  const persistedIdentity = JSON.parse(await readFile(join(userData, 'desktop-endpoint-identity.json'), 'utf8'));
  assert.equal(persistedIdentity.principalId, identity.principalId);
  const accessAfterRestart = await page.evaluate(() => (window as any).electronAPI.computer.access());
  assert.ok(accessAfterRestart.authorizedAppIds.includes(apps[0].appId));
  assert.equal(JSON.parse(await readFile(oraclePath, 'utf8')).verifyClicks, 1);
  evidence.restart = { sameEncryptedPrincipal: true, newEndpointConnection: true, authorizationPersisted: true, noInputReplay: true };
  await page.evaluate(() => (window as any).electronAPI.computer.stop());
  evidence.stopped = true; evidence.passed = true;
} catch (error) {
  evidence.failure = error instanceof Error ? error.message : String(error); throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (desktop?.pid) spawnSync('taskkill', ['/PID', String(desktop.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  fixture?.kill();
  if (evidence.passed) {
    const db = new DatabaseSync(join(root, 'xopc.db'), { readOnly: true });
    try { evidence.endpointAudit = db.prepare('SELECT tool_name, status, COUNT(*) AS count FROM endpoint_tool_invocations GROUP BY tool_name, status').all(); }
    finally { db.close(); }
  }
  if (installed) {
    const uninstaller = join(installDir, 'Uninstall xopc.exe');
    if (existsSync(uninstaller)) {
      const removed = spawnSync(uninstaller, ['/S', `_?=${installDir}`], { windowsHide: true, timeout: 90_000 });
      evidence.uninstallerExitCode = removed.status;
      evidence.uninstalled = !existsSync(join(installDir, 'xopc.exe'));
    }
  }
  if (hadProtocol) spawnSync('reg.exe', ['import', protocolBackup], { windowsHide: true, stdio: 'ignore' });
  else {
    const current = spawnSync('reg.exe', ['query', `${protocolKey}\\shell\\open\\command`, '/ve'], { windowsHide: true, encoding: 'utf8' });
    if (current.stdout.includes(installDir)) spawnSync('reg.exe', ['delete', protocolKey, '/f'], { windowsHide: true, stdio: 'ignore' });
  }
  evidence.finishedAt = new Date().toISOString();
  evidence.passed = evidence.passed && evidence.uninstalled === true;
  await writeFile(join(output, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(`Installed Windows evidence: ${join(output, 'result.json')}`);
}
assert.equal(evidence.uninstalled, true, 'Disposable NSIS installation must be removed');
