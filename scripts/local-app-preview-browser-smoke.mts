/** Real Gateway/browser preview modes, isolated writes and deterministic acceptance. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import type { LocalAppPreviewSession } from '@xopcai/gateway-contract';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');
const directory = mkdtempSync(join(tmpdir(), 'xopc-preview-browser-'));
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
  assert.equal((await fetch(`${origin}/api/local-app-previews/sessions/missing`)).status, 401);
  const { app } = await request('/api/local-apps', 'POST', { name: 'Preview modes fixture', idea: 'Verify safe preview modes' });
  const operations = (await request('/api/capabilities/operations')).capabilities;
  async function operate(id: string, input: unknown) {
    const descriptor = operations.find((item: { id: string }) => item.id === id);
    return (await request(`/api/capabilities/operations/${id}/invocations`, 'POST', {
      majorVersion: descriptor.majorVersion, descriptorDigest: descriptor.descriptorDigest, input, idempotencyKey: crypto.randomUUID(),
    })).data;
  }
  const note = (await operate('xopc.notes.create', { title: 'Production note', markdown: 'PRODUCTION SECRET' })).note;
  const privateNote = (await operate('xopc.notes.create', { title: 'Private note', markdown: 'PRIVATE UNAPPROVED' })).note;
  const catalog = (await request('/api/local-app-capabilities/catalog')).capabilities;
  const manifestPath = join(app.workspaceRoot, 'xopc.extension.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.ui.capabilities = catalog.map(({ id, majorVersion, descriptorDigest }: { id: string; majorVersion: number; descriptorDigest: string }) => ({ id, majorVersion, descriptorDigest }));
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(join(app.workspaceRoot, '.xopc', 'fixtures.json'), JSON.stringify({ schemaVersion: 1,
    notes: [{ id: note.id, title: 'Example note', markdown: 'EXAMPLE ONLY' }], tasks: [] }));
  const scenario = (id: string) => ({ id, name: `Isolated ${id}`, steps: [
    { assert: 'value_equals', target: 'note-body', value: 'EXAMPLE ONLY' },
    { assert: 'value_equals', target: 'storage-state', value: 'fresh' },
    { action: 'click', target: 'save' },
    { assert: 'text_visible', text: 'Saved to preview' },
    { assert: 'value_equals', target: 'click-count', value: '1' },
  ] });
  writeFileSync(join(app.workspaceRoot, '.xopc', 'acceptance.json'), JSON.stringify({ schemaVersion: 1, scenarios: [scenario('first'), scenario('second')] }));
  writeFileSync(join(app.workspaceRoot, 'ui', 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Preview modes</title><link rel="stylesheet" href="./styles.css"></head><body><main class="hero">
    <h1>Preview modes fixture</h1><p id="list">Preparing data</p>
    <label>Note body<textarea aria-label="Note body" data-xopc-test-id="note-body" readonly></textarea></label>
    <label>Storage state<input aria-label="Storage state" data-xopc-test-id="storage-state" readonly></label>
    <label>Click count<input aria-label="Click count" data-xopc-test-id="click-count" value="0" readonly></label>
    <button id="save" data-xopc-test-id="save" disabled>Save to preview</button><output aria-live="polite"></output>
  </main><script type="module" src="./app.js"></script></body></html>`);
  const application = `import { createExtensionClient } from ${JSON.stringify(join(process.cwd(), 'packages/extension-ui-sdk/src/index.ts'))};
    const client = createExtensionClient();
    try {
    let loaded = document.readyState === 'complete';
    let dataReady = false; let bound = false; let clicks = 0;
    addEventListener('load', () => { loaded = true; bindButton(); }, { once: true });
    await client.whenReady();
    async function call(id, input, key) {
      const descriptor = await client.capability.describe(id);
      return (await client.capability.call(id, { majorVersion: descriptor.majorVersion, descriptorDigest: descriptor.descriptorDigest, input, ...(key ? { idempotencyKey: key } : {}) })).data;
    }
    const list = await call('xopc.notes.list', {});
    let currentNote = list.items.length ? (await call('xopc.notes.get', { id: list.items[0].id })).note : null;
    document.querySelector('#list').textContent = list.items.map(item => item.title).join(', ');
    document.querySelector('textarea').value = currentNote?.markdown ?? 'empty';
    document.querySelector('[data-xopc-test-id="storage-state"]').value = await client.storage.get('fixture') ?? 'fresh';
    // Binding needs both the load event and async SDK data, in either order.
    function bindButton() {
      if (!loaded || !dataReady || bound) return; bound = true;
      const button = document.querySelector('#save'); button.disabled = false;
      button.addEventListener('click', async () => {
        clicks++; document.querySelector('[data-xopc-test-id="click-count"]').value = String(clicks);
        try {
          await new Promise(resolve => setTimeout(resolve, 75));
          const result = await call('xopc.notes.append', { id: currentNote.id, expectedRevision: currentNote.remoteVersion, content: 'Preview stamp' }, crypto.randomUUID());
          currentNote = result.note;
          await client.storage.set('fixture', 'changed in this preview');
          document.querySelector('textarea').value = currentNote.markdown;
          document.querySelector('output').textContent = 'Saved to preview';
        } catch (error) { document.querySelector('output').textContent = 'Access denied: ' + error.message; }
      });
    }
    dataReady = true; bindButton();
    } catch (error) { document.querySelector('#list').textContent = 'Access denied: ' + error.message; }`;
  await build({ stdin: { contents: application, resolveDir: process.cwd(), sourcefile: 'preview-fixture.js' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: join(app.workspaceRoot, 'ui', 'app.js') });
  const db = new DatabaseSync(join(directory, 'xopc.db'), { readOnly: true });
  const fingerprint = () => {
    db.exec('BEGIN');
    try {
      return JSON.stringify([
        db.prepare('SELECT * FROM notes ORDER BY note_id').all(), db.prepare('SELECT * FROM notes_fts ORDER BY rowid').all(),
        db.prepare('SELECT * FROM tasks ORDER BY task_id').all(),
        db.prepare("SELECT * FROM capability_operations WHERE capability_id NOT LIKE 'xopc.local_apps.%' ORDER BY operation_id").all(),
        db.prepare("SELECT i.* FROM capability_invocations i JOIN capability_operations o ON o.operation_id = i.operation_id WHERE o.capability_id NOT LIKE 'xopc.local_apps.%' ORDER BY i.invocation_id").all(),
        db.prepare("SELECT event_id, event_type, subject_kind, subject_id, correlation_id, causation_id, payload_json, created_at, operation_id FROM domain_outbox WHERE subject_kind != 'local_app' ORDER BY event_id").all(),
        db.prepare("SELECT * FROM durable_state WHERE namespace = 'extension-ui' ORDER BY scope, key").all(),
      ]);
    } finally { db.exec('COMMIT'); }
  };
  const before = fingerprint();
  browser = await chromium.launch({ executablePath: process.env.XOPC_SMOKE_BROWSER ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext();
  assert.ok((await context.request.post(`${origin}/api/browser-session`, { headers: { Authorization: `Bearer ${token}`, Origin: origin } })).ok());
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(30000);
  await page.addLocatorHandler(page.getByRole('button', { name: /^(Maybe later, keep using my current model|暂时不用，继续使用现有模型)$/ }), async button => button.click());
  const sessions: LocalAppPreviewSession[] = [];
  page.on('response', response => {
    if (response.status() === 201 && /\/api\/local-app-previews\/[^/]+\/sessions$/.test(response.url())) {
      void response.json().then(result => sessions.push(result.session));
    }
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/#/local-apps/${app.id}`);
  await page.addLocatorHandler(page.locator('.xopc-onboarding-dialog'), async () => { await page.keyboard.press('Escape'); });
  const frame = () => page.frameLocator('iframe[title$=" preview"]');
  async function previewReady(body: string) {
    await frame().getByRole('button', { name: 'Save to preview' }).waitFor();
    await page.waitForFunction(() => document.querySelector('iframe[title$=" preview"]') !== null);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await frame().getByRole('textbox', { name: 'Note body' }).inputValue().catch(() => '') === body
        && await frame().getByRole('button', { name: 'Save to preview' }).isEnabled().catch(() => false)) return;
      await page.waitForTimeout(25);
    }
    assert.fail(`Preview did not finish loading ${body}`);
  }
  const save = () => page.getByRole('button', { name: /^(Add to sidebar|添加到左侧导航)$/ });
  async function accepted() {
    await page.getByText(/^(Draft accepted|草稿已通过验收)$/, { exact: true }).waitFor();
    await page.waitForFunction(() => {
      const buttons = [...document.querySelectorAll('button')];
      return buttons.some(button => /^(Add to sidebar|添加到左侧导航)$/.test(button.textContent?.trim() ?? '') && !button.disabled);
    }, { timeout: 30000 });
  }
  async function mode(name: RegExp) {
    await page.getByRole('button', { name: /^(Preview data|预览数据)$/ }).click();
    await page.getByRole('button', { name }).click();
  }
  async function browserRequest(path: string, method = 'GET', body?: unknown) {
    return context.request.fetch(`${origin}${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, data: body === undefined ? undefined : JSON.stringify(body) });
  }
  const pinned = (id: string, input: unknown) => {
    const descriptor = catalog.find((item: { id: string }) => item.id === id);
    return { method: 'capability.call', params: { id, call: { majorVersion: descriptor.majorVersion, descriptorDigest: descriptor.descriptorDigest, input, idempotencyKey: crypto.randomUUID() } } };
  };
  async function readonly() {
    await mode(/^(Real data · read only|真实数据 · 只读)$/);
    const dialog = page.getByRole('dialog');
    const group = dialog.getByRole('group', { name: /^(Notes this app may read|读取笔记的范围)$/ });
    if (await group.getByRole('button', { name: /^(Notes this app may read|读取笔记的范围)$/ }).textContent().then(text => !text?.includes('Selected'))) {
      await group.getByRole('button', { name: /^(Notes this app may read|读取笔记的范围)$/ }).click();
      await page.getByRole('button', { name: /^(Selected records or projects|仅选择的记录或项目)$/ }).click();
    }
    await group.getByRole('checkbox', { name: 'Production note', exact: true }).check();
    await dialog.getByRole('button', { name: /^(Start read-only preview|启动只读预览)$/ }).click();
    await previewReady('PRODUCTION SECRET');
    assert.equal(await frame().getByRole('textbox', { name: 'Note body' }).inputValue(), 'PRODUCTION SECRET');
    return sessions.filter(session => session.mode === 'readonly').at(-1)!;
  }
  await accepted();
  await previewReady('EXAMPLE ONLY');
  assert.equal(await frame().getByRole('textbox', { name: 'Note body' }).inputValue(), 'EXAMPLE ONLY');
  assert.equal(await frame().getByRole('textbox', { name: 'Storage state' }).inputValue(), 'fresh');
  await frame().getByRole('button', { name: 'Save to preview' }).click();
  await frame().getByText('Saved to preview').waitFor();
  assert.equal(await frame().getByRole('textbox', { name: 'Click count' }).inputValue(), '1');
  assert.equal(fingerprint(), before, 'Sample writes must not touch production data or operation receipts');
  console.log('PASS: sample data, real capability writes in a separate database, SDK initialization before load, async assertions and independent acceptance scenarios.');
  await mode(/^(Isolated writes|隔离写入体验)$/);
  await previewReady('EXAMPLE ONLY');
  assert.equal(await frame().getByRole('textbox', { name: 'Storage state' }).inputValue(), 'fresh');
  assert.equal(await frame().getByRole('textbox', { name: 'Note body' }).inputValue(), 'EXAMPLE ONLY');
  const lease = await readonly();
  assert.ok(lease); assert.equal((await browserRequest(`/api/local-app-previews/sessions/${lease.id}/requests`, 'POST', pinned('xopc.notes.get', { id: privateNote.id }))).status(), 403);
  assert.equal((await browserRequest(`/api/local-app-previews/sessions/${lease.id}/requests`, 'POST', pinned('xopc.notes.create', { title: 'blocked' }))).status(), 403);
  await frame().getByRole('button', { name: 'Save to preview' }).click();
  await frame().getByText(/^Access denied:/).waitFor();
  const approvals = sessions.filter(session => session.mode === 'readonly').length;
  await page.getByRole('button', { name: /^(Run again|重新验收)$/ }).click();
  await accepted();
  assert.equal(sessions.filter(session => session.mode === 'readonly').length, approvals, 'Acceptance reruns must not renew a live-data grant');
  assert.equal(fingerprint(), before, 'Readonly preview and hidden acceptance must not mutate production data');
  const evidence = process.env.XOPC_SMOKE_ARTIFACT_DIR ?? join(tmpdir(), 'xopc-local-app-preview-evidence'); mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, 'readonly-preview.png') });
  await page.getByRole('button', { name: /^(Stop live preview|停止真实数据预览)$/ }).click();
  for (let i = 0; i < 100; i++) {
    if ((await browserRequest(`/api/local-app-previews/sessions/${lease.id}`)).status() === 403) break;
    await page.waitForTimeout(20);
  }
  assert.equal((await browserRequest(`/api/local-app-previews/sessions/${lease.id}`)).status(), 403);
  console.log('PASS: explicit scoped real-data preview without installation, production writes denied, stop revokes the lease.');
  const stale = await readonly();
  const originalSource = readFileSync(join(app.workspaceRoot, 'ui', 'app.js'), 'utf8');
  writeFileSync(join(app.workspaceRoot, 'ui', 'app.js'), `${readFileSync(join(app.workspaceRoot, 'ui', 'app.js'), 'utf8')}\n// Source changed\n`);
  assert.equal((await browserRequest(`/api/local-app-previews/sessions/${stale.id}`)).status(), 409);
  await page.getByRole('button', { name: /^(Run again|重新验收)$/ }).click();
  await accepted();
  await previewReady('EXAMPLE ONLY');
  assert.equal(await frame().getByRole('textbox', { name: 'Note body' }).inputValue(), 'EXAMPLE ONLY', 'New source must not inherit live preview approval');
  writeFileSync(join(app.workspaceRoot, 'ui', 'app.js'), originalSource);
  await page.getByRole('button', { name: /^(Run again|重新验收)$/ }).click();
  await accepted();
  await previewReady('EXAMPLE ONLY');
  assert.equal(await frame().getByRole('textbox', { name: 'Note body' }).inputValue(), 'EXAMPLE ONLY', 'Restoring an old source hash must not resurrect its live-data grant');
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: /^(Run again|重新验收)$/ }).click();
    await accepted();
    const detail = (await request(`/api/local-apps/${app.id}`)).app;
    assert.equal(detail.acceptanceRuns[0].status, 'passed');
    assert.ok(detail.acceptanceRuns[0].checks.find((item: { id: string; status: string }) => item.id === 'criteria' && item.status === 'passed'));
  }
  assert.equal(fingerprint(), before);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(evidence, 'isolated-acceptance.png') });
  assert.equal((await request(`/api/local-apps/${app.id}`)).app.installationState, 'not_installed');
  console.log('PASS: immutable draft binding, edit invalidates access without automatic regrant, repeated delayed-load/async-write acceptance passes without retries or production effects.');
  const handoff = await request(`/api/local-apps/${app.id}/development-conversation`, 'POST');
  assert.equal((await request(`/api/local-apps/${app.id}/development-conversation`, 'POST')).conversationId, handoff.conversationId);
  const { app: advisory } = await request('/api/local-apps', 'POST', { name: 'Advisory acceptance fixture', idea: 'Install with a failing scenario' });
  writeFileSync(join(advisory.workspaceRoot, '.xopc', 'acceptance.json'), JSON.stringify({ schemaVersion: 1, scenarios: [{
    id: 'expected-failure', name: 'Advisory failure', steps: [{ assert: 'text_visible', text: 'Deliberately missing acceptance text' }],
  }] }));
  await page.goto(`${origin}/#/local-apps/${advisory.id}`);
  await page.getByText(/^(Acceptance needs attention|自动验收未通过)$/, { exact: true }).waitFor();
  await save().click();
  const installDialog = page.getByRole('dialog');
  await installDialog.getByText(/Automatic acceptance failed or is incomplete|自动验收未通过或尚未完成/).waitFor();
  await installDialog.getByText(/Deliberately missing acceptance text/).waitFor();
  await installDialog.getByRole('button', { name: /^(Install|确认安装)$/, exact: true }).click();
  await page.getByRole('button', { name: /^(Disable|禁用)$/, exact: true }).waitFor();
  const installedAdvisory = (await request(`/api/local-apps/${advisory.id}`)).app;
  assert.equal(installedAdvisory.installationState, 'installed');
  assert.equal(installedAdvisory.acceptanceRuns[0].status, 'failed');
  console.log('PASS: stable app development handoff and installation with failed acceptance, visible diagnostics retained.');
  db.close();
} catch (error) {
  console.error('Gateway output:', output);
  if (activePage) {
    console.error('Browser URL:', activePage.url());
    console.error((await activePage.locator('body').innerText().catch(() => '')).slice(-8000));
    for (const child of activePage.frames().slice(1)) console.error('Frame:', child.url(), await child.locator('body').innerText().catch(() => 'unavailable'));
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
