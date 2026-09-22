/** Disposable real Gateway/browser release lifecycle; no external providers. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');
const directory = mkdtempSync(join(tmpdir(), 'xopc-release-browser-'));
const workspace = join(directory, 'workspace');
mkdirSync(workspace);
const listener = createServer();
await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = (listener.address() as { port: number }).port;
await new Promise<void>(resolve => listener.close(() => resolve()));
const origin = `http://127.0.0.1:${port}`;
const token = 'disposable-release-fixture';
const config = join(directory, 'xopc.json');
writeFileSync(config, JSON.stringify({ gateway: { bind: 'loopback', port, auth: { mode: 'token', token } }, browser: { enabled: false } }));
function startGateway() {
const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/bin.ts', 'gateway', '--port', String(port), '--bind', 'loopback', '--no-hot-reload'], {
  env: { PATH: process.env.PATH, XOPC_STATE_DIR: directory, XOPC_WORKSPACE: workspace, XOPC_CONFIG_PATH: config, XOPC_CONFIG: config,
    XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1', XOPC_LOG_LEVEL: 'fatal' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout!.on('data', data => { output = (output + data).slice(-8000); });
child.stderr!.on('data', data => { output = (output + data).slice(-8000); });
return child;
}
let output = '';
let child = startGateway();
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${origin}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(response.ok, `${path}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}
async function readyGateway() {
  let ready = false;
  for (let i = 0; i < 300; i++) {
    try { ready = (await (await fetch(`${origin}/api/health`)).json()).ready === true; } catch {}
    if (ready || child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.ok(ready, output);
}
try {
  await readyGateway();
  const { app } = await request('/api/local-apps', 'POST', { name: 'Release browser fixture', idea: 'Local lifecycle verification' });
  const catalog = await request('/api/capabilities/operations');
  const descriptor = catalog.capabilities.find((item: { id: string }) => item.id === 'xopc.notes.list');
  assert.ok(descriptor);
  const manifestPath = join(app.workspaceRoot, 'xopc.extension.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.ui.capabilities = [{ id: descriptor.id, majorVersion: descriptor.majorVersion, descriptorDigest: descriptor.descriptorDigest }];
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const source = join(app.workspaceRoot, 'ui', 'app.js');
  writeFileSync(source, `${readFileSync(source, 'utf8')}
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.data?.source !== 'xopc-host') return;
  const message = event.data;
  if (message.type === 'init') window.parent.postMessage({ source: 'xopc-extension', type: 'request', requestId: 'fixture-call',
    method: 'capability.call', params: { id: ${JSON.stringify(descriptor.id)}, call: {
      majorVersion: ${descriptor.majorVersion}, descriptorDigest: ${JSON.stringify(descriptor.descriptorDigest)}, input: {}
    } } }, '*');
  if (message.type === 'response' && message.requestId === 'fixture-call') {
    document.documentElement.dataset.capabilityResult = message.error ? JSON.stringify(message.error) : message.result?.status;
  }
});
`);
  browser = await chromium.launch({ executablePath: process.env.XOPC_SMOKE_BROWSER ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext();
  const session = await context.request.post(`${origin}/api/browser-session`, { headers: { Authorization: `Bearer ${token}`, Origin: origin } });
  assert.ok(session.ok(), await session.text());
  const page = await context.newPage();
  page.on('pageerror', error => console.error('Browser error:', error.message));
  page.setDefaultTimeout(30000);
  await page.goto(origin);
  await page.locator('.xopc-onboarding-dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.xopc-onboarding-dialog').waitFor({ state: 'hidden' });
  const workbench = `${origin}/#/local-apps/${app.id}`;
  async function install(update = false) {
    await page.goto(workbench);
    console.log('Workbench:', await page.title());
    const onboarding = page.locator('.xopc-onboarding-dialog');
    if (await onboarding.waitFor({ timeout: 1000 }).then(() => true, () => false)) {
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button', { name: update ? /^(Install current update|安装当前更新)$/ : /^(Add to sidebar|添加到左侧导航)$/ }).waitFor().catch(async error => {
      console.error((await page.locator('body').innerText()).slice(-6000));
      throw error;
    });
    await page.getByRole('button', { name: update ? /^(Install current update|安装当前更新)$/ : /^(Add to sidebar|添加到左侧导航)$/ }).click().catch(async error => {
      console.error('URL:', page.url(), (await page.locator('body').innerText()).slice(-6000));
      throw error;
    });
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith(`/api/local-apps/${app.id}/install`) && response.status() === 200),
      page.getByRole('dialog').getByRole('button', { name: /^(Install|确认安装)$/ }).click(),
    ]);
    return (await request(`/api/local-apps/${app.id}`)).app;
  }
  async function openInstalled() {
    const grant = (await request(`/api/extensions/${app.extensionId}/ui-grant`)).grant;
    await page.goto(`${origin}/#/extensions/${app.extensionId}`);
    if (!grant.granted) await page.getByRole('button', { name: /^(Allow|允许)$/ }).click();
    const frame = page.frameLocator('iframe').first();
    await frame.getByRole('button', { name: '开始使用' }).click();
    await frame.getByText('应用已就绪').waitFor();
    await frame.locator('html[data-capability-result="succeeded"]').waitFor();
  }
  const first = await install();
  assert.equal(first.activeVersion, 1);
  await openInstalled();
  const firstGrant = (await request(`/api/extensions/${app.extensionId}/ui-grant`)).grant;
  assert.equal(firstGrant.granted, true);
  // Inject a crash checkpoint after the filesystem changed but before SQLite committed.
  const pending = join(directory, 'local-apps', 'pending-releases');
  mkdirSync(pending, { recursive: true });
  writeFileSync(join(pending, app.id), '', { flush: true });
  const installedSource = join(directory, 'extensions', app.extensionId, 'ui', 'app.js');
  const committedSource = readFileSync(installedSource, 'utf8');
  writeFileSync(installedSource, '// interrupted replacement');
  const killed = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await killed;
  child = startGateway();
  await readyGateway();
  assert.equal(readFileSync(installedSource, 'utf8'), committedSource);
  assert.equal((await request(`/api/local-apps/${app.id}`)).app.activeVersion, 1);
  console.log('PASS: SIGKILL checkpoint restart restored the committed release.');
  writeFileSync(source, `${readFileSync(source, 'utf8')}\n// Release two fixture\n`);
  const second = await install(true);
  assert.equal(second.activeVersion, 2);
  const newGrant = (await request(`/api/extensions/${app.extensionId}/ui-grant`)).grant;
  assert.equal(newGrant.granted, false);
  assert.notEqual(newGrant.manifestDigest, firstGrant.manifestDigest);
  await openInstalled();
  await page.goto(workbench);
  for (const enabled of [false, true]) {
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith(enabled ? '/enable' : '/disable') && response.status() === 200),
      page.getByRole('button', { name: enabled ? /^(Enable|启用)$/ : /^(Disable|禁用)$/ }).click(),
    ]);
    assert.equal((await request(`/api/local-apps/${app.id}`)).app.enabled, enabled);
    if (!enabled) {
      const denied = await fetch(`${origin}/api/local-app-capabilities/${app.extensionId}?manifestDigest=${newGrant.manifestDigest}`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(denied.status, 403);
    }
  }
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/rollback') && response.status() === 200),
    page.getByRole('button', { name: /^(Restore|恢复)$/ }).click(),
  ]);
  assert.equal((await request(`/api/local-apps/${app.id}`)).app.activeVersion, 1);
  await openInstalled();
  await page.goto(workbench);
  await page.getByRole('button', { name: /^(Uninstall app|卸载应用)$/ }).click();
  await Promise.all([
    page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith('/install') && response.status() === 200),
    page.getByRole('button', { name: /^(Uninstall and keep Project|卸载但保留 Project)$/ }).click(),
  ]);
  const removed = (await request(`/api/local-apps/${app.id}`)).app;
  assert.equal(removed.installationState, 'not_installed');
  assert.equal(removed.releases.length, 2);
  console.log('PASS: browser acceptance, install, permission grant, iframe capability invocation, upgrade/regrant, disable/enable, rollback, uninstall with retained releases.');
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    await exited;
    clearTimeout(timer);
  }
  rmSync(directory, { recursive: true, force: true });
}
