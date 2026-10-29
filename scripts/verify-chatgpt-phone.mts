/** Real GPT + existing xopc ChatGPT OAuth through authenticated Gateway and Android ADB. */
import '../src/infra/http-proxy-env.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { AgentDefaultsSchema } from '../src/agent-config/schema.js';
import { seedTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { ConfigSchema } from '../src/config/schema.js';
import { resolveConfigPath, resolveCredentialsDir, resolveStateDir } from '../src/config/paths.js';
import { getProviderAuthState, resolveModel } from '../src/providers/index.js';
import { closeXopcDatabase, openXopcDatabase } from '../src/storage/sqlite/connection.js';
import { AdbPhoneDriver, resolveAdbPath, runAdb } from '../src/phone/adb-driver.js';
import { CloudAdbConnection, PhoneCloudKeyStore } from '../src/phone/cloud-adb.js';
import { PhoneRepository } from '../src/phone/repository.js';
import type { PhoneDevice } from '../src/phone/contracts.js';
import { phoneModelProfile } from '../src/phone/model-policy.js';
import { readScrcpyServer, scrcpyServerPath } from '../src/phone/scrcpy-assets.js';

const argument = (name: string) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const modelRef = argument('--model') ?? 'openai/gpt-6.1-sol';
let serial = argument('--serial') ?? 'emulator-5580';
const deviceName = argument('--device-name');
const evidence = resolve(argument('--output') ?? join(tmpdir(), `xopc-chatgpt-phone-${randomUUID()}`));
const model = resolveModel(modelRef);
assert.equal(model.provider, 'openai');
assert.equal(phoneModelProfile(model), 'structured-tools-phone-v1');
assert.equal((await getProviderAuthState('openai')).authMode, 'oauth', 'Sign in with ChatGPT inside xopc first');
const credentials = resolveCredentialsDir();
const originalConfig = JSON.parse(await readFile(resolveConfigPath(), 'utf8'));
const adb = resolveAdbPath();
const signal = AbortSignal.timeout(420_000);
let selected: PhoneDevice | undefined;
let originalDb: DatabaseSync | undefined;
let originalLease: string | undefined;
let connection: CloudAdbConnection | undefined;
if (deviceName) {
  originalDb = new DatabaseSync(join(resolveStateDir(), 'xopc.db'));
  const matches = (originalDb.prepare("SELECT payload FROM durable_state WHERE namespace='phone.devices' AND scope=''").all() as Array<{ payload: string }>)
    .map(row => JSON.parse(row.payload) as PhoneDevice).filter(device => device.name === deviceName && device.enabled && device.connection?.kind === 'aliyun-adb');
  assert.equal(matches.length, 1, 'Choose one uniquely named registered Aliyun phone');
  selected = matches[0]; serial = selected.serial;
  connection = new CloudAdbConnection(selected.connection!.endpoint, await new PhoneCloudKeyStore().load(selected.connection!.credentialId));
}
const driver = connection?.driver() ?? new AdbPhoneDriver(adb);
const shell = async (...args: string[]) => (connection
  ? await connection.command('', ['-s', serial, 'shell', ...args], signal, 20_000)
  : await runAdb(adb, ['-s', serial, 'shell', ...args], signal)).toString().trim();
if (!selected) {
  assert((await driver.discover(signal)).some(device => device.serial === serial && device.emulator && device.state === 'device'), 'Choose an online local test emulator');
  assert.equal(await shell('getprop', 'ro.boot.qemu.avd_name'), 'XOPC_Android_Test_API_35', 'Only the dedicated test AVD is supported');
  assert.equal(await shell('getprop', 'sys.boot_completed'), '1');
}
const scrcpy = await readScrcpyServer();
const state = await mkdtemp(join(tmpdir(), 'xopc-chatgpt-phone-state-'));
await mkdir(evidence, { recursive: true });
const probe = createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
const address = probe.address(); assert(address && typeof address !== 'string');
const port = address.port; await new Promise<void>(done => probe.close(() => done()));
const gatewayToken = randomUUID(); const base = `http://127.0.0.1:${port}`;
const configPath = join(state, 'xopc.json');
Object.assign(process.env, { XOPC_STATE_DIR: state, XOPC_CONFIG_PATH: configPath, XOPC_CONFIG: configPath,
  XOPC_CREDENTIALS_DIR: credentials, XOPC_MODELS_JSON: join(state, 'models.json'), XOPC_WORKSPACE: state,
  XOPC_LOG_CONSOLE: 'false', XOPC_LOG_FILE: 'false', XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1', PI_CODING_AGENT_DIR: join(state, 'pi') });
const config = ConfigSchema.parse({ gateway: { bind: 'loopback', port, auth: { mode: 'token', token: gatewayToken },
  ...(originalConfig.gateway?.outboundProxy ? { outboundProxy: originalConfig.gateway.outboundProxy } : {}) },
  phone: { enabled: true, adbPath: adb, modelRequestTimeoutMs: 90_000, maxOperationDurationMs: 240_000 }, browser: { enabled: false } });
await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
await writeFile(join(state, 'models.json'), JSON.stringify({ providers: {} }), { mode: 0o600 });
await mkdir(resolve(scrcpyServerPath(), '..'), { recursive: true });
await writeFile(scrcpyServerPath(), scrcpy);
scrcpy.fill(0);
openXopcDatabase();
seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: modelRef }, phoneUse: { primary: modelRef } },
  tools: { phone_use: { mode: 'allow' } } }), agents: [{ id: 'main', enabled: true, workspace: state }] });
closeXopcDatabase();
const sampledSettings = ['screen_brightness', 'screen_brightness_mode', 'screen_off_timeout', 'font_scale'];
const settingsSnapshot = async () => Object.fromEntries(await Promise.all(sampledSettings.map(async key => [key, await shell('settings', 'get', 'system', key)])));
let initialSettings: Awaited<ReturnType<typeof settingsSnapshot>> | undefined;
const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/bin.ts', 'gateway', '--port', String(port), '--bind', 'loopback', '--no-hot-reload'],
  { cwd: resolve('.'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout!.on('data', chunk => { logs = (logs + chunk).slice(-16000); }); child.stderr!.on('data', chunk => { logs = (logs + chunk).slice(-16000); });
const headers = { Authorization: `Bearer ${gatewayToken}`, 'Content-Type': 'application/json' };
async function request(path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers, signal: AbortSignal.timeout(110_000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json() as { payload?: any; error?: { code?: string } };
  assert(response.ok, `${path}: HTTP ${response.status} ${data.error?.code ?? ''}`);
  return data.payload;
}
const result: Record<string, unknown> = { passed: false, testedAt: new Date().toISOString(), modelRef, auth: 'ChatGPT OAuth',
  device: selected?.name ?? 'XOPC_Android_Test_API_35', transport: selected ? 'aliyun-adb' : 'local-adb', stateIsolated: true, personalScreenshots: false, evidence };
let sessionId: string | undefined;
try {
  console.log(JSON.stringify({ phase: 'gateway-start', modelRef, evidence }));
  let ready = false;
  for (let attempt = 0; attempt < 240; attempt++) {
    assert.equal(child.exitCode, null, 'Isolated Gateway exited during startup');
    try { const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok && (await response.json() as any).ready) { ready = true; break; } } catch { /* Starting. */ }
    await delay(250);
  }
  assert(ready, 'Gateway startup timed out');
  assert.equal((await fetch(`${base}/api/phone/models`)).status, 401);
  result.authenticatedGateway = true;
  const models = (await request('/api/phone/models')).models;
  assert(models.some((entry: any) => entry.id === modelRef && entry.configured && entry.profile === 'structured-tools-phone-v1'), 'GPT not listed as a configured phone model');
  console.log(JSON.stringify({ phase: 'synthetic-image-diagnostic' }));
  const diagnostic = await request('/api/phone/models/diagnostics', { modelRef });
  result.synthetic = diagnostic;
  assert.equal(diagnostic.protocolValid, true); assert.equal(diagnostic.groundingVerified, true); assert.equal(diagnostic.deviceActions, 0);
  if (originalDb && selected) {
    originalDb.exec('BEGIN IMMEDIATE');
    try {
      const row = originalDb.prepare("SELECT payload FROM durable_state WHERE namespace='phone.leases' AND scope='' AND key=?").get(selected.serial) as { payload: string } | undefined;
      assert(!row || JSON.parse(row.payload).expiresAt <= Date.now(), 'Registered phone has an active owner');
      originalLease = randomUUID();
      originalDb.prepare("INSERT INTO durable_state(namespace,scope,key,payload) VALUES('phone.leases','',?,?) ON CONFLICT(namespace,scope,key) DO UPDATE SET payload=excluded.payload")
        .run(selected.serial, JSON.stringify({ token: originalLease, expiresAt: Date.now() + 600_000 }));
      originalDb.exec('COMMIT');
    } catch (error) { originalDb.exec('ROLLBACK'); throw error; }
    result.registeredDeviceLease = true;
  }
  initialSettings = await settingsSnapshot();
  await shell('am', 'force-stop', 'com.android.settings');
  await shell('am', 'start', '-a', 'android.settings.SETTINGS');
  await delay(1000);
  const before = await driver.observe(serial, signal);
  const chinese = before.elements.some(node => /显示|设置/.test(node.text)); before.frame.fill(0); await driver.releaseInput();
  const targets = chinese ? ['字体大小', '显示大小'] : ['Font size', 'Display size'];
  let device: { id: string };
  if (selected) {
    openXopcDatabase();
    try { device = new PhoneRepository().save({ ...selected, name: 'GPT OAuth test phone', appAccess: 'selected', allowedApps: ['com.android.settings'] }); }
    finally { closeXopcDatabase(); }
  } else device = await request('/api/phone/devices', { serial, name: 'GPT OAuth test emulator', appAccess: 'selected', allowedApps: ['com.android.settings'] });
  const opened = await request('/api/phone/sessions', { deviceId: device.id, mode: 'control', agentId: 'main' });
  sessionId = opened.id; assert.equal(opened.report.modelRef, modelRef); assert.equal(opened.report.mock, false);
  console.log(JSON.stringify({ phase: 'native-phone-goal', targets }));
  await request(`/api/phone/sessions/${sessionId}/execute`, { op: 'run',
    goal: `Open the Display page in Android Settings and confirm these options are visible: ${targets.join(', ')}. Only navigate and read. Do not toggle options or modify any settings. Do not open another application.`,
    completion: { appPackage: 'com.android.settings', textAll: targets, requireChange: true }, maxActions: 6 });
  let report: any;
  for (let attempt = 0; attempt < 480; attempt++) {
    report = await request(`/api/phone/sessions/${sessionId}`);
    if (report.status !== 'running' && report.modelRequests > 0) break;
    await delay(500);
  }
  result.native = { status: report.status, verified: report.verified, verificationLevel: report.verificationLevel, stopReason: report.stopReason,
    errorCode: report.errorCode, actions: report.actions, modelRequests: report.modelRequests, steps: report.steps, performance: report.performance };
  console.log(JSON.stringify({ phase: 'native-phone-result', status: report.status, verified: report.verified, actions: report.actions, modelRequests: report.modelRequests, errorCode: report.errorCode }));
  await request(`/api/phone/sessions/${sessionId}/execute`, { op: 'close' }); sessionId = undefined;
  const final = await driver.observe(serial, signal);
  const nativeVerified = final.package === 'com.android.settings' && targets.every(text => final.elements.some(node => node.text === text
    && node.bounds[0] >= 0 && node.bounds[1] >= 0 && node.bounds[2] <= final.width && node.bounds[3] <= final.height
    && node.bounds[2] > node.bounds[0] && node.bounds[3] > node.bounds[1]));
  await writeFile(join(evidence, 'final-settings.png'), final.frame); final.frame.fill(0); await driver.releaseInput();
  result.independentNativeCheck = nativeVerified;
  result.settingsUnchanged = JSON.stringify(await settingsSnapshot()) === JSON.stringify(initialSettings);
  assert.equal(report.status, 'completed'); assert.equal(report.verified, true); assert.equal(report.verificationLevel, 'ui');
  assert(report.actions > 0 && report.modelRequests > 0); assert(report.steps.every((step: any) => step.dispatch === 'completed'));
  assert(nativeVerified, 'Independent native UI verification failed'); assert.equal(result.settingsUnchanged, true);
  result.passed = true;
} catch (error) {
  result.error = error instanceof assert.AssertionError ? error.message : error instanceof Error ? error.name : 'UnknownError';
  process.exitCode = 1;
} finally {
  if (sessionId && child.exitCode === null && child.signalCode === null) await request(`/api/phone/sessions/${sessionId}/execute`, { op: 'close' }).catch(() => {});
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    await Promise.race([exited, delay(10_000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await driver.releaseInput(); connection?.dispose(); closeXopcDatabase();
  if (originalDb) {
    if (originalLease && selected) originalDb.prepare("DELETE FROM durable_state WHERE namespace='phone.leases' AND scope='' AND key=? AND json_extract(payload,'$.token')=?")
      .run(selected.serial, originalLease);
    originalDb.close();
  }
  await rm(state, { recursive: true, force: true });
  await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
