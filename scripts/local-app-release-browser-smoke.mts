/** Disposable real Gateway/browser release lifecycle; no external providers. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
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
    XOPC_UI_STATIC_ROOT: process.env.XOPC_SMOKE_UI_ROOT, XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1', XOPC_LOG_LEVEL: 'fatal' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout!.on('data', data => { output = (output + data).slice(-8000); });
child.stderr!.on('data', data => { output = (output + data).slice(-8000); });
return child;
}
let output = '';
let child = startGateway();
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let activePage: import('playwright-core').Page | undefined;
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
  const catalog = await request('/api/local-app-capabilities/catalog');
  const operations = await request('/api/capabilities/operations');
  async function operate(id: string, input: unknown, key = crypto.randomUUID()) {
    const contract = operations.capabilities.find((item: { id: string }) => item.id === id);
    assert.ok(contract, id);
    return (await request(`/api/capabilities/operations/${id}/invocations`, 'POST', {
      majorVersion: contract.majorVersion, descriptorDigest: contract.descriptorDigest, input, idempotencyKey: key,
    })).data;
  }
  const project = (await operate('xopc.projects.create', { name: 'Allowed project' })).project;
  const privateProject = (await operate('xopc.projects.create', { name: 'Private project' })).project;
  const allowedNote = (await operate('xopc.notes.create', { title: 'Allowed note', markdown: 'Visible fixture', projectId: project.id })).note;
  const privateNote = (await operate('xopc.notes.create', { title: 'Private note', markdown: 'Secret fixture', projectId: privateProject.id })).note;
  const allowedTask = (await operate('xopc.tasks.create', { title: 'Allowed task', projectId: project.id, contract: { objective: 'Private execution contract', expectedOutputs: [], acceptanceCriteria: [], constraints: [], approvalRequired: [], assumptions: [], risks: [], outputDestinations: [] }, activation: { mode: 'capture' } })).model.task;
  const privateTask = (await operate('xopc.tasks.create', { title: 'Private task', projectId: privateProject.id, contract: { objective: 'Secret contract', expectedOutputs: [], acceptanceCriteria: [], constraints: [], approvalRequired: [], assumptions: [], risks: [], outputDestinations: [] }, activation: { mode: 'capture' } })).model.task;
  const descriptor = catalog.capabilities.find((item: { id: string }) => item.id === 'xopc.notes.list');
  assert.ok(descriptor);
  const manifestPath = join(app.workspaceRoot, 'xopc.extension.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.ui.capabilities = catalog.capabilities.map(({ id, majorVersion, descriptorDigest }: { id: string; majorVersion: number; descriptorDigest: string }) => ({ id, majorVersion, descriptorDigest }));
  writeFileSync(join(app.workspaceRoot, 'private.txt'), 'not a public asset');
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
  const page = await context.newPage(); activePage = page;
  page.on('pageerror', error => console.error('Browser error:', error.message));
  page.setDefaultTimeout(30000);
  await page.addLocatorHandler(page.getByRole('button', { name: /^(Maybe later, keep using my current model|暂时不用，继续使用现有模型)$/ }), async button => { await button.click(); });
  await page.goto(origin);
  if (await page.locator('.xopc-onboarding-dialog').waitFor({ timeout: 1500 }).then(() => true, () => false)) {
    await page.keyboard.press('Escape');
    await page.locator('.xopc-onboarding-dialog').waitFor({ state: 'hidden' });
  }
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
    if (!grant.granted) {
      const dialog = page.getByRole('dialog');
      for (const name of [/^(Notes this app may read|读取笔记的范围)$/, /^(Notes this app may change or create|修改与创建笔记的范围)$/, /^(Tasks this app may read|读取任务的范围)$/]) {
        await dialog.getByRole('button', { name }).click();
        await page.getByRole('button', { name: /^(Selected records or projects|仅选择的记录或项目)$/ }).click();
        const section = dialog.getByRole('group', { name });
        await section.getByRole('checkbox', { name: 'Allowed project', exact: true }).check();
        const own = section.getByRole('checkbox', { name: /^(Include notes created by this app|包括此应用创建的笔记)$/ });
        if (await own.count()) await own.check();
      }
      const reviewEvidence = process.env.XOPC_SMOKE_ARTIFACT_DIR ?? join(tmpdir(), 'xopc-local-app-security-evidence');
      mkdirSync(reviewEvidence, { recursive: true });
      await page.screenshot({ path: join(reviewEvidence, 'permission-review.png') });
      await dialog.getByRole('button', { name: /^(Allow|允许)$/ }).click();
    }
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
  async function frameRequest(method: string, params: unknown) {
    const frame = page.frames().find(item => item.url().includes(`/api/extensions/${app.extensionId}/assets/`));
    assert.ok(frame, 'Installed frame is missing');
    return frame.evaluate(`new Promise((resolve, reject) => {
      const { method, params } = ${JSON.stringify({ method, params })};
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { removeEventListener('message', receive); reject(new Error('Bridge request timed out')); }, 10000);
      function receive(event) {
        if (event.source !== parent || event.data?.source !== 'xopc-host' || event.data.requestId !== requestId) return;
        clearTimeout(timeout); removeEventListener('message', receive); resolve(event.data);
      }
      addEventListener('message', receive);
      parent.postMessage({ source: 'xopc-extension', extensionId: 'forged-other-app', type: 'request', requestId, method, params }, '*');
    })`) as Promise<{ result?: any; error?: { message: string } }>;
  }
  function capabilityCall(id: string, input: unknown, key = crypto.randomUUID()) {
    const contract = catalog.capabilities.find((item: { id: string }) => item.id === id);
    return { id, call: { majorVersion: contract.majorVersion, descriptorDigest: contract.descriptorDigest, input, idempotencyKey: key } };
  }
  async function invoke(id: string, input: unknown = {}, key?: string) {
    return frameRequest('capability.call', capabilityCall(id, input, key));
  }
  const list = await invoke('xopc.notes.list', { limit: 1 });
  assert.equal(list.result.data.total, 1); assert.equal(list.result.data.items[0].id, allowedNote.id);
  assert.equal(list.result.data.items[0].projects, undefined);
  assert.deepEqual((await invoke('xopc.notes.list', { search: 'Secret fixture' })).result.data.items, []);
  assert.deepEqual((await invoke('xopc.notes.list', { limit: 1, offset: 1 })).result.data.items, []);
  assert.ok((await invoke('xopc.notes.get', { id: privateNote.id })).error);
  assert.ok((await invoke('xopc.notes.update', { id: privateNote.id, expectedRevision: privateNote.remoteVersion, patch: { title: 'Blocked' } })).error);
  const taskList = (await invoke('xopc.tasks.list')).result.data;
  assert.equal(taskList.total, 1); assert.equal(taskList.items[0].task.id, allowedTask.id);
  assert.equal(taskList.items[0].task.contract, undefined);
  const taskDetail = (await invoke('xopc.tasks.get', { id: allowedTask.id })).result.data;
  for (const key of ['context', 'conversation', 'authorityGrants', 'dependencies', 'runs']) assert.equal(taskDetail[key], undefined);
  assert.ok((await invoke('xopc.tasks.get', { id: privateTask.id })).error);
  const writeKey = crypto.randomUUID();
  const created = (await invoke('xopc.notes.create', { title: 'App owned note' }, writeKey)).result.data.note;
  assert.equal((await invoke('xopc.notes.create', { title: 'App owned note' }, writeKey)).result.data.note.id, created.id);
  assert.equal((await invoke('xopc.notes.get', { id: created.id })).result.data.note.title, 'App owned note');
  assert.equal((await frameRequest('storage.set', { key: 'fixture', value: 'retained' })).error, undefined);
  assert.equal((await frameRequest('storage.get', { key: 'fixture' })).result, 'retained');
  assert.equal((await fetch(`${origin}/api/extensions/${app.extensionId}/storage`, { headers: { Authorization: `Bearer ${token}` } })).status, 403);
  for (const path of ['APP_BRIEF.md', 'xopc.extension.json', '.xopc/runtime/local-ui.js', 'private.txt']) {
    assert.equal((await fetch(`${origin}/api/extensions/${app.extensionId}/assets/${path}`)).status, 404, path);
  }
  const releasePath = join(directory, 'local-apps', 'releases', app.id, 'v1', 'ui', 'app.js');
  const publishedBytes = readFileSync(releasePath, 'utf8');
  writeFileSync(releasePath, '// changed after publishing');
  assert.equal((await fetch(`${origin}/api/extensions/${app.extensionId}/assets/ui/app.js`)).status, 404);
  rmSync(releasePath); symlinkSync(join(app.workspaceRoot, 'private.txt'), releasePath);
  assert.equal((await fetch(`${origin}/api/extensions/${app.extensionId}/assets/ui/app.js`)).status, 404);
  rmSync(releasePath); writeFileSync(releasePath, publishedBytes);
  let egress = 0;
  await context.route('https://xopc-egress.invalid/**', async route => { egress++; await route.abort(); });
  const frame = page.frames().find(item => item.url().includes(`/api/extensions/${app.extensionId}/assets/`))!;
  const sandbox = await page.locator('iframe').first().getAttribute('sandbox');
  assert.equal(sandbox, 'allow-scripts');
  const isolation = await frame.evaluate(async () => {
    let parentBlocked = false; try { void parent.document; } catch { parentBlocked = true; }
    let networkBlocked = false; try { await fetch('https://xopc-egress.invalid/fetch'); } catch { networkBlocked = true; }
    const popupBlocked = window.open('https://xopc-egress.invalid/popup') === null;
    return { parentBlocked, networkBlocked, popupBlocked };
  });
  assert.deepEqual(isolation, { parentBlocked: true, networkBlocked: true, popupBlocked: true });
  await frame.evaluate(() => { location.href = 'https://xopc-egress.invalid/navigation'; });
  await page.waitForTimeout(200);
  assert.equal(egress, 0, 'Sandbox egress must be blocked by the iframe and embedding CSP');
  // A CSP-blocked self-navigation may replace the frame with a browser error document.
  await page.reload(); await openInstalled();
  const pinnedCall = capabilityCall('xopc.notes.get', { id: allowedNote.id });
  await request(`/api/extensions/${app.extensionId}/ui-grant`, 'DELETE', { manifestDigest: firstGrant.manifestDigest });
  assert.ok((await frameRequest('storage.get', { key: 'fixture' })).error);
  assert.ok((await invoke('xopc.notes.get', { id: allowedNote.id })).error);
  const staleRequest = () => fetch(`${origin}/api/local-app-capabilities/${app.extensionId}/${pinnedCall.id}/invocations`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifestDigest: firstGrant.manifestDigest, grantRevision: firstGrant.grantRevision, call: pinnedCall.call }),
  });
  assert.equal((await staleRequest()).status, 403);
  const narrowed = (await request(`/api/extensions/${app.extensionId}/ui-grant`, 'POST', {
    manifestDigest: firstGrant.manifestDigest,
    resourceScopes: { notesRead: { mode: 'selected', ids: [allowedNote.id] } },
  })).grant;
  assert.notEqual(narrowed.grantRevision, firstGrant.grantRevision);
  assert.equal((await staleRequest()).status, 403);
  assert.ok((await invoke('xopc.notes.get', { id: allowedNote.id })).error, 'Old frame cannot acquire new grant revision');
  await page.reload(); await openInstalled();
  assert.equal((await invoke('xopc.notes.get', { id: allowedNote.id })).result.data.note.id, allowedNote.id);
  assert.ok((await invoke('xopc.notes.get', { id: created.id })).error, 'Narrowing must remove previous ownership access');
  const audit = await request(`/api/extensions/${app.extensionId}/access-audit`);
  assert.ok(audit.items.some((item: { status: string }) => item.status === 'denied'));
  assert.ok(!JSON.stringify(audit).includes('Secret fixture'));
  const evidence = process.env.XOPC_SMOKE_ARTIFACT_DIR ?? join(tmpdir(), 'xopc-local-app-security-evidence');
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, 'installed-app.png') });
  console.log('PASS: real authenticated Gateway and browser enforce scoped reads/writes, counts/search/pagination, projections, app ownership, storage authorization, revocation/regrant, asset inventory/integrity and sandbox egress.');
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
  assert.equal((await invoke('xopc.notes.create', { title: 'App owned note' }, writeKey)).result.data.note.id, created.id, 'The original write must replay across releases');
  const activeGrant = (await request(`/api/extensions/${app.extensionId}/ui-grant`)).grant;
  await page.goto(workbench);
  for (const enabled of [false, true]) {
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith(enabled ? '/enable' : '/disable') && response.status() === 200),
      page.getByRole('button', { name: enabled ? /^(Enable|启用)$/ : /^(Disable|禁用)$/ }).click(),
    ]);
    assert.equal((await request(`/api/local-apps/${app.id}`)).app.enabled, enabled);
    if (!enabled) {
      const denied = await fetch(`${origin}/api/local-app-capabilities/${app.extensionId}?manifestDigest=${newGrant.manifestDigest}&grantRevision=${activeGrant.grantRevision}`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(denied.status, 403);
    }
  }
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/rollback') && response.status() === 200),
    page.getByRole('button', { name: /^(Restore|恢复)$/ }).click(),
  ]);
  assert.equal((await request(`/api/local-apps/${app.id}`)).app.activeVersion, 1);
  assert.equal((await request(`/api/extensions/${app.extensionId}/ui-grant`)).grant.granted, false, 'Rollback must not resurrect a prior grant');
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
} catch (error) {
  console.error('Gateway output:', output);
  if (activePage) {
    console.error('Browser URL:', activePage.url());
    console.error((await activePage.locator('body').innerText().catch(() => '')).slice(-8000));
    await activePage.screenshot({ path: join(tmpdir(), 'xopc-local-app-browser-failure.png') }).catch(() => {});
  }
  throw error;
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
