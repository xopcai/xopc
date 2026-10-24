/** Actual Android cloud-device verification through an isolated authenticated Gateway. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { ConfigSchema } from '../src/config/schema.js';
import { resolveCredentialsDir, resolveStateDir } from '../src/config/paths.js';
import { AgentDefaultsSchema } from '../src/agent-config/schema.js';
import { seedTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { closeXopcDatabase, openXopcDatabase } from '../src/storage/sqlite/connection.js';
import { AgentCatalogRepository } from '../src/agent-catalog/repository.js';
import { PhoneRepository } from '../src/phone/repository.js';
import { PhoneCloudKeyStore, CloudAdbConnection } from '../src/phone/cloud-adb.js';
import type { PhoneDevice } from '../src/phone/contracts.js';
import { getApiKey, resetModelRegistry, getModelRegistry } from '../src/providers/index.js';
import { XopcCloudModelSource } from '../src/providers/xopc-cloud-model-source.js';
import { getModelCatalogStore } from '../src/providers/model-catalog-store.js';
import { ModelCatalogPersistence } from '../src/providers/model-catalog-persistence.js';
import { applyXopcCloudCapabilitySetup } from '../src/gateway/xopc-cloud-capability-setup.js';

assert(process.env.XOPC_PHONE_REAL_MODEL === '1', 'Set XOPC_PHONE_REAL_MODEL=1 for actual device/model operations');
const originalState = resolveStateDir();
const credentials = resolveCredentialsDir();
const records = JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', join(originalState, 'xopc.db'),
  "SELECT payload FROM durable_state WHERE namespace='phone.devices'"], { encoding: 'utf8' })) as Array<{ payload: string }>;
const devices = records.map(row => JSON.parse(row.payload) as PhoneDevice);
const name = process.env.XOPC_PHONE_DEVICE_NAME ?? '阿里云测试手机';
const selected = devices.find(device => device.name === name && device.enabled && device.connection?.kind === 'aliyun-adb');
assert(selected?.connection, 'Choose an enabled registered Aliyun test phone with XOPC_PHONE_DEVICE_NAME');
const leases = JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', join(originalState, 'xopc.db'),
  "SELECT key,payload FROM durable_state WHERE namespace='phone.leases'"], { encoding: 'utf8' }) || '[]') as Array<{ key: string; payload: string }>;
assert(!leases.some(row => row.key === selected.serial && JSON.parse(row.payload).expiresAt > Date.now()), 'Test phone has an active owner');
const cloudToken = await getApiKey('xopc-cloud');
assert(cloudToken, 'Connect XOPC Cloud before verification');
assert(process.env.ZHIPU_API_KEY, 'Independent BigModel verification requires ZHIPU_API_KEY');
const fetched = await new XopcCloudModelSource().fetch();
assert.equal(fetched.status, 'fetched');
if (fetched.status !== 'fetched') throw Error('Cloud catalog unavailable');
assert(fetched.models.some(model => model.id === 'phone' && model.phoneUse?.profile === 'autoglm-phone-v1'));
const connection = new CloudAdbConnection(selected.connection.endpoint, await new PhoneCloudKeyStore().load(selected.connection.credentialId));
const driver = connection.driver();
const command = (...args: string[]) => connection.command('', ['-s', selected.serial, ...args], AbortSignal.timeout(20_000), 20_000);
const model = (await command('shell', 'getprop', 'ro.product.model')).toString().trim();
const state = await mkdtemp(join(tmpdir(), 'xopc-phone-cloud-e2e-'));
const evidence = resolve(process.env.XOPC_PHONE_EVIDENCE ?? '/tmp/xopc-phone-cloud-e2e-evidence');
await mkdir(evidence, { recursive: true });
const probe = createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
const address = probe.address(); assert(address && typeof address !== 'string');
const port = address.port; await new Promise<void>(done => probe.close(() => done()));
const gatewayToken = randomUUID(); const base = `http://127.0.0.1:${port}`;
const configPath = join(state, 'xopc.json');
Object.assign(process.env, { XOPC_STATE_DIR: state, XOPC_CONFIG_PATH: configPath, XOPC_CONFIG: configPath,
  XOPC_WORKSPACE: state, XOPC_MODELS_JSON: join(state, 'models.json'), XOPC_CREDENTIALS_DIR: credentials,
  XOPC_LOG_CONSOLE: 'false', XOPC_LOG_FILE: 'false', XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1', PI_CODING_AGENT_DIR: join(state, 'pi') });
let config = ConfigSchema.parse({ gateway: { bind: 'loopback', port, auth: { mode: 'token', token: gatewayToken } },
  phone: { enabled: true }, browser: { enabled: false } });
await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
await writeFile(join(state, 'models.json'), JSON.stringify({ providers: { 'phone-bigmodel': {
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-completions', apiKey: 'ZHIPU_API_KEY',
  models: [{ id: 'autoglm-phone', name: 'Independent BigModel Phone', input: ['text', 'image'], maxTokens: 2048, phoneUse: { profile: 'autoglm-phone-v1' } }],
} } }), { mode: 0o600 });
closeXopcDatabase(); openXopcDatabase();
seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: 'xopc-cloud/auto' } }, tools: { phone_use: { mode: 'allow' } } }), agents: [{ id: 'main', enabled: true, workspace: state }] });
const store = getModelCatalogStore(); store.replaceSourceModels('xopc-cloud', fetched.source, fetched.models);
await new ModelCatalogPersistence().save(store.getSource('xopc-cloud')!);
resetModelRegistry(); getModelRegistry().refresh();
const service = { get currentConfig() { return config; }, saveConfig: async (next: typeof config) => {
  config = next; await writeFile(configPath, JSON.stringify(config), { mode: 0o600 }); return { saved: true };
} };
assert.equal((await applyXopcCloudCapabilitySetup(service)).configured, true);
assert.equal(new AgentCatalogRepository().getSettings().defaults.models.phoneUse?.primary, 'xopc-cloud/phone');
const device = new PhoneRepository().save({ ...selected, name: 'Cloud model E2E test', appAccess: 'selected', allowedApps: ['com.android.settings'] });
new PhoneRepository().setDefault(device.id);
closeXopcDatabase();
const sampledSettings = ['screen_brightness', 'screen_brightness_mode', 'screen_off_timeout', 'font_scale'];
const settingsSnapshot = async () => Object.fromEntries(await Promise.all(sampledSettings.map(async key => [key, (await command('shell', 'settings', 'get', 'system', key)).toString().trim()])));
const initialSettings = await settingsSnapshot();
let logs = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/bin.ts', 'gateway', '--port', String(port), '--bind', 'loopback', '--no-hot-reload'], { cwd: resolve('.'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout!.on('data', chunk => { logs = (logs + chunk).slice(-16_000); });
child.stderr!.on('data', chunk => { logs = (logs + chunk).slice(-16_000); });
const headers = { Authorization: `Bearer ${gatewayToken}`, 'Content-Type': 'application/json' };
async function request(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${base}${path}`, { method, headers, signal: AbortSignal.timeout(90_000), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json() as { payload?: any; error?: unknown };
  assert(response.ok, `${path}: HTTP ${response.status} ${JSON.stringify(data.error)}`); return data.payload;
}
const trials: Array<Record<string, unknown>> = [];
let sessionId: string | undefined;
try {
  let ready = false;
  for (let attempt = 0; attempt < 240; attempt++) {
    assert.equal(child.exitCode, null, `Gateway exited: ${logs.slice(-2000)}`);
    try { const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok && (await response.json() as any).ready) { ready = true; break; } } catch {}
    await delay(250);
  }
  assert(ready, `Gateway startup failed: ${logs.slice(-2000)}`);
  assert.equal((await fetch(`${base}/api/phone/devices`)).status, 401);
  assert.equal((await request('/api/global-defaults')).defaults.models.phoneUse.primary, 'xopc-cloud/phone');
  const choices = (await request('/api/phone/models')).models;
  for (const id of ['xopc-cloud/phone', 'phone-bigmodel/autoglm-phone']) assert(choices.some((entry: any) => entry.id === id && entry.configured), `Missing configured model ${id}`);
  for (const [index, ref] of ['xopc-cloud/phone', 'phone-bigmodel/autoglm-phone', 'xopc-cloud/phone'].entries()) {
    if (index) {
      const current = await request('/api/global-defaults');
      await request('/api/global-defaults', { defaults: { ...current.defaults, models: { ...current.defaults.models, phoneUse: { primary: ref, fallbacks: [] } } }, scope: 'models', expectedModels: current.defaults.models }, 'PATCH');
    }
    await command('shell', 'am', 'force-stop', 'com.android.settings');
    await command('shell', 'am', 'start', '-a', 'android.settings.SETTINGS');
    await delay(1200);
    const before = await driver.observe(selected.serial, AbortSignal.timeout(30_000));
    const chinese = before.elements.some(node => /显示|设置/.test(node.text)); before.frame.fill(0);
    const targets = chinese ? ['字体大小', '自动旋转屏幕'] : ['Font size', 'Auto-rotate screen'];
    const brightness = chinese ? '亮度' : 'Brightness level';
    const opened = await request('/api/phone/sessions', { deviceId: device.id, mode: 'control', agentId: 'main' });
    sessionId = opened.id;
    assert.equal(opened.report.modelRef, ref);
    await request(`/api/phone/sessions/${sessionId}/execute`, { op: 'run',
      goal: `打开 Android 设置里的显示设置页面，确认 ${targets.join('、')} 选项可见。只查看页面，不修改亮度、主题或任何设置，不进入其他应用。`,
      completion: { appPackage: 'com.android.settings', textAll: targets, requireChange: true }, maxActions: 6 });
    let report: any;
    for (let attempt = 0; attempt < 240; attempt++) {
      report = await request(`/api/phone/sessions/${sessionId}`); if (report.status !== 'running') break; await delay(500);
    }
    const final = await driver.observe(selected.serial, AbortSignal.timeout(30_000));
    const visible = final.package === 'com.android.settings'
      && targets.every(text => final.elements.some(node => node.text === text))
      && final.elements.some(node => node.resourceId === 'android:id/title' && node.text === brightness);
    const settingsUnchanged = JSON.stringify(await settingsSnapshot()) === JSON.stringify(initialSettings);
    await writeFile(join(evidence, `trial-${index + 1}.png`), final.frame); final.frame.fill(0);
    const trial = { modelRef: ref, status: report.status, verified: report.verified, stopReason: report.stopReason,
      errorCode: report.errorCode, actions: report.actions, modelRequests: report.modelRequests, independentNativeCheck: visible, settingsUnchanged };
    trials.push(trial); console.log(JSON.stringify(trial));
    await request(`/api/phone/sessions/${sessionId}/execute`, { op: 'close' }); sessionId = undefined;
    assert(settingsUnchanged, 'Sampled Settings values changed');
    assert.equal(report.verified, true, JSON.stringify(trial)); assert(visible, 'Independent native UI check failed');
    assert(report.actions > 0 && report.modelRequests > 0, 'Actual inference and native action required');
  }
  // Reconnect completion preserves the persisted independent model, with the Gateway stopped.
  child.kill('SIGTERM'); await once(child, 'exit');
  openXopcDatabase();
  const repo = new AgentCatalogRepository(); const current = repo.getSettings();
  repo.updateDefaults({ ...current.defaults, models: { ...current.defaults.models, phoneUse: { primary: 'phone-bigmodel/autoglm-phone', fallbacks: [] } } }, current.revision);
  assert.equal((await applyXopcCloudCapabilitySetup(service)).configured, true);
  assert.equal(repo.getSettings().defaults.models.phoneUse?.primary, 'phone-bigmodel/autoglm-phone'); closeXopcDatabase();
  const summary = { passed: true, device: name, deviceModel: model, authenticatedGateway: true,
    stateIsolated: true, cloudDefaultAfterConnection: true, independentModelPreservedAfterReconnect: true, trials };
  await writeFile(join(evidence, 'result.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
} catch (error) {
  await writeFile(join(evidence, 'failure.json'), JSON.stringify({ passed: false, trials, message: error instanceof Error ? error.message : String(error) }, null, 2));
  throw error;
} finally {
  if (sessionId && child.exitCode === null && child.signalCode === null) await request(`/api/phone/sessions/${sessionId}/execute`, { op: 'close' }).catch(() => {});
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), delay(10_000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
  try {
    const finalSettings = await settingsSnapshot().catch(() => null);
    if (finalSettings) for (const key of sampledSettings) if (finalSettings[key] !== initialSettings[key]) {
      if (initialSettings[key] === 'null') await command('shell', 'settings', 'delete', 'system', key);
      else await command('shell', 'settings', 'put', 'system', key, initialSettings[key]!);
    }
  } finally {
    connection.dispose(); closeXopcDatabase(); await rm(state, { recursive: true, force: true });
  }
}
