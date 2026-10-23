import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { ConfigSchema } from '../src/config/schema.js';
import { AgentDefaultsSchema } from '../src/agent-config/schema.js';
import { seedTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { closeXopcDatabase, openXopcDatabase } from '../src/storage/sqlite/connection.js';
import { AdbPhoneDriver, resolveAdbPath, runAdb } from '../src/phone/adb-driver.js';
import { MOCK_PHONE_MODEL, MOCK_PHONE_GOAL } from '../src/phone/contracts.js';

const root = resolve('.');
const state = await mkdtemp(join(tmpdir(), 'xopc-phone-smoke-'));
const evidence = resolve(process.env.XOPC_PHONE_EVIDENCE ?? '/tmp/xopc-phone-use-evidence');
await mkdir(evidence, { recursive: true });
const adb = resolveAdbPath(process.env.XOPC_PHONE_ADB_PATH);
const found = (await new AdbPhoneDriver(adb).discover()).find(device => device.state === 'device' && device.emulator);
assert(found, 'Start a local Android emulator before running this verification');
const serial = process.env.XOPC_PHONE_EMULATOR_SERIAL ?? found.serial;
assert((await new AdbPhoneDriver(adb).discover()).some(device => device.serial === serial && device.emulator), 'Verification only runs on a local emulator');
const probe = createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
const address = probe.address(); assert(address && typeof address !== 'string');
const port = address.port; await new Promise<void>(done => probe.close(() => done()));
const token = randomUUID(); const base = `http://127.0.0.1:${port}`;
const configPath = join(state, 'xopc.json');
Object.assign(process.env, { XOPC_STATE_DIR: state, XOPC_CONFIG_PATH: configPath, XOPC_CONFIG: configPath, XOPC_WORKSPACE: state, XOPC_MODELS_JSON: join(state, 'models.json'), XOPC_LOG_CONSOLE: 'false', XOPC_LOG_FILE: 'false', XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1', PI_CODING_AGENT_DIR: join(state, 'pi') });
const config = ConfigSchema.parse({ gateway: { bind: 'loopback', port, auth: { mode: 'token', token } }, phone: { enabled: true, adbPath: adb }, browser: { enabled: false } });
await writeFile(configPath, JSON.stringify(config));
await writeFile(join(state, 'models.json'), JSON.stringify({ providers: {} }));
openXopcDatabase();
seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: 'xopc-cloud/auto' }, phoneUse: { primary: MOCK_PHONE_MODEL } }, tools: { phone_use: { mode: 'allow' } } }), agents: [{ id: 'main', enabled: true, workspace: state, profile: { name: 'Phone test' } }] });
closeXopcDatabase();
let logs = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/bin.ts', 'gateway', '--port', String(port), '--bind', 'loopback', '--no-hot-reload'], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout!.on('data', chunk => { logs = (logs + chunk).slice(-16000); });
child.stderr!.on('data', chunk => { logs = (logs + chunk).slice(-16000); });
async function request(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const result = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await result.json() as { payload?: any; error?: unknown };
  assert(result.ok, `${path}: HTTP ${result.status} ${JSON.stringify(data.error)}`);
  return data.payload;
}
let browser: import('playwright-core').Browser | undefined;
try {
  let ready = false;
  for (let attempt = 0; attempt < 240; attempt++) {
    if (child.exitCode !== null) throw new Error(`Gateway exited (${child.exitCode}): ${logs.slice(-2500)}`);
    try { const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) }); const body = await response.json() as { ready?: boolean }; if (response.ok && body.ready) { ready = true; break; } } catch { /* Still starting. */ }
    await delay(250);
  }
  assert(ready, `Gateway did not become ready: ${logs.slice(-2500)}`);
  const unauthenticated = await fetch(`${base}/api/phone/devices`); assert.equal(unauthenticated.status, 401);
  const discovery = await request('/api/phone/devices'); assert(discovery.discovery.some((device: { serial: string }) => device.serial === serial));
  const device = await request('/api/phone/devices', { serial, name: 'Local emulator test', allowedApps: ['com.android.settings'] });
  const diagnostic = await request(`/api/phone/devices/${device.id}/diagnostics`, {}); assert.equal(diagnostic.state, 'device');
  await request('/api/models-json', { config: { providers: { 'phone-bigmodel': { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-completions', apiKey: 'ZHIPU_API_KEY', models: [{ id: 'autoglm-phone', input: ['text', 'image'], phoneUse: { profile: 'autoglm-phone-v1' } }] } } } }, 'PATCH');
  const models = await request('/api/phone/models'); assert(models.models.some((model: { id: string }) => model.id === 'phone-bigmodel/autoglm-phone'));
  if (process.env.XOPC_PHONE_BROWSER_ONLY !== '1') {
  // Only the emulator's Settings task is reset; app data and account settings are untouched.
  await runAdb(adb, ['-s', serial, 'shell', 'am', 'force-stop', 'com.android.settings']);
  const opened = await request('/api/phone/sessions', { deviceId: device.id, mode: 'control', appPackage: 'com.android.settings' });
  await request(`/api/phone/sessions/${opened.id}/execute`, { op: 'run', goal: MOCK_PHONE_GOAL, scenario: 'settings-about', maxActions: 8 });
  let report: any;
  for (let attempt = 0; attempt < 240; attempt++) {
    report = await request(`/api/phone/sessions/${opened.id}`);
    if (report.status !== 'running') break;
    await delay(500);
  }
  assert.equal(report.status, 'completed', JSON.stringify(report)); assert.equal(report.verified, true, JSON.stringify(report)); assert.equal(report.mock, true); assert(report.actions >= 2);
  const screen = await fetch(`${base}/api/phone/sessions/${opened.id}/screen`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(screen.status, 200); assert.equal(screen.headers.get('cache-control'), 'no-store');
  const png = Buffer.from(await screen.arrayBuffer()); assert.equal(png.subarray(1, 4).toString(), 'PNG');
  // Explicit test artifacts live outside user state; production previews do not persist pixels.
  await writeFile(join(evidence, 'emulator-about.png'), png);
  await request(`/api/phone/sessions/${opened.id}/execute`, { op: 'close' });
  let realModel: unknown;
  if (process.env.XOPC_PHONE_REAL_MODEL === '1') {
    assert(process.env.ZHIPU_API_KEY, 'Export ZHIPU_API_KEY before running the opt-in real-model test');
    const modelDiagnostic = await request('/api/phone/models/diagnostics', { modelRef: 'phone-bigmodel/autoglm-phone' });
    assert.equal(modelDiagnostic.protocolValid, true); assert.equal(modelDiagnostic.groundingVerified, true, JSON.stringify(modelDiagnostic));
    const defaults = await request('/api/global-defaults');
    await request('/api/global-defaults', { defaults: { ...defaults.defaults, models: { ...defaults.defaults.models, phoneUse: { primary: 'phone-bigmodel/autoglm-phone', fallbacks: [] } } }, scope: 'models', expectedModels: defaults.defaults.models }, 'PATCH');
    const live = await request('/api/phone/sessions', { deviceId: device.id, mode: 'control' });
    await request(`/api/phone/sessions/${live.id}/execute`, { op: 'run', goal: '从当前关于手机页面按一次返回，回到 Android 设置列表，确认 System 选项可见。只返回，不修改设置，不进入其他页面。', expectText: 'System', maxActions: 3 });
    let result: any;
    for (let attempt = 0; attempt < 240; attempt++) { result = await request(`/api/phone/sessions/${live.id}`); if (result.status !== 'running') break; await delay(500); }
    realModel = { modelDiagnostic, status: result.status, verified: result.verified, actions: result.actions, modelRequests: result.modelRequests, stopReason: result.stopReason, errorCode: result.errorCode, steps: result.steps };
    await request(`/api/phone/sessions/${live.id}/execute`, { op: 'close' });
    await writeFile(join(evidence, 'real-model-result.json'), JSON.stringify(realModel, null, 2));
    assert.equal(result.verified, true, JSON.stringify(realModel)); assert(result.modelRequests > 0, 'The live test must actually call the model');
    await request('/api/global-defaults', { defaults: defaults.defaults, scope: 'models' }, 'PATCH');
  }
  const summary = { ok: true, testedAt: new Date().toISOString(), authenticatedGateway: true, localEmulator: serial,
    mock: { verified: report.verified, verificationLevel: report.verificationLevel, actions: report.actions, modelRequests: report.modelRequests, steps: report.steps },
    modelPreset: { id: preset.modelRef, credentialReference: preset.credentialReference }, screenPreview: true, stateIsolated: true, ...(realModel ? { realModel } : {}) };
  await writeFile(join(evidence, 'result.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  }
  if (process.env.XOPC_PHONE_BROWSER === '1') {
    const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, reducedMotion: 'reduce' });
    const exchanged = await context.request.post(`${base}/api/browser-session`, { headers: { Authorization: `Bearer ${token}`, Origin: base } });
    assert.equal(exchanged.status(), 200, 'Browser cookie session exchange failed');
    await context.addInitScript(({ origin }) => { if (location.origin === origin) localStorage.setItem('xopc.language', 'en'); }, { origin: base });
    const page = await context.newPage(); const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`${base}/#/settings/phone-use`);
    const later = page.getByText('Maybe later, keep using my current model', { exact: true });
    try { await later.waitFor({ timeout: 10_000 }); await later.click(); await page.getByText('Skip for now', { exact: true }).click(); await page.waitForURL(/#\/chat/, { timeout: 10_000 }); } catch { /* An already configured profile may skip onboarding. */ }
    await page.goto(`${base}/#/settings/phone-use`);
    await page.getByRole('heading', { name: 'Phone Use', exact: true }).waitFor({ timeout: 60_000 });
    await page.getByText('Local emulator test', { exact: true }).first().waitFor();
    await page.waitForTimeout(1000);
    if (!page.url().endsWith('#/settings/phone-use')) { await page.goto(`${base}/#/settings/phone-use`); await page.getByRole('heading', { name: 'Phone Use', exact: true }).waitFor(); await page.waitForTimeout(800); }
    assert(page.url().endsWith('#/settings/phone-use'), 'Onboarding navigation displaced Phone Use settings');
    await page.getByRole('button', { name: 'Manage', exact: true }).click();
    const deviceDialog = page.getByRole('dialog', { name: 'Manage phone', exact: true });
    await deviceDialog.getByLabel('Name', { exact: true }).fill('Verified emulator');
    await deviceDialog.getByRole('button', { name: 'Save phone', exact: true }).click();
    await deviceDialog.waitFor({ state: 'hidden' });
    await page.getByText('Verified emulator', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Manage', exact: true }).click();
    await deviceDialog.getByLabel('Name', { exact: true }).fill('Local emulator test');
    await deviceDialog.getByRole('button', { name: 'Save phone', exact: true }).click();
    await deviceDialog.waitFor({ state: 'hidden' });

    await page.screenshot({ path: join(evidence, 'phone-settings-desktop.png'), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: join(evidence, 'phone-settings-dark.png'), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(700);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Phone settings overflow at 375px');
    await page.screenshot({ path: join(evidence, 'phone-settings-mobile.png'), fullPage: true });
    assert.deepEqual(pageErrors, []);
    await writeFile(join(evidence, 'browser-result.json'), JSON.stringify({ browser: true, responsive: true, deviceManagement: true, darkPreview: true, pageErrors }, null, 2));
    console.log(JSON.stringify({ browser: true, responsive: true, deviceManagement: true, pageErrors }));
  }
} catch (error) {
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: join(evidence, 'browser-failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(evidence, 'browser-failure.html'), await page.content()).catch(() => {});
    console.log(JSON.stringify({ pageUrl: page.url(), visibleText: (await page.locator('body').innerText()).slice(0, 2500) }));
  }
  throw error;
} finally {
  await browser?.close(); child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), delay(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await rm(state, { recursive: true, force: true });
}
