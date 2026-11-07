/** Real Gateway + SDK + Chrome delegation boundary; local scripted model transport, no paid provider. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');
const directory = mkdtempSync(join(tmpdir(), 'xopc-delegation-browser-'));
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
const modelRequests: Array<Record<string, any>> = [];
let holdResponse: (() => void) | undefined;
const modelServer = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const delegation = JSON.stringify(body.messages).includes('Perform only the supplied text task.');
  if (delegation) modelRequests.push(body);
  const finish = () => {
    if (res.destroyed) return;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: unknown, finish_reason: string | null) => res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    chunk({ role: 'assistant', content: 'Delegated result: reviewed the approved note.' }, null);
    chunk({}, 'stop'); res.end('data: [DONE]\n\n');
  };
  if (delegation && JSON.stringify(body.messages).includes('HOLD REQUEST')) holdResponse = finish; else finish();
});
await new Promise<void>(resolve => modelServer.listen(0, '127.0.0.1', resolve));
const modelPort = (modelServer.address() as { port: number }).port;
const modelsPath = join(directory, 'models.json');
writeFileSync(modelsPath, JSON.stringify({ providers: { 'delegation-fixture': { baseUrl: `http://127.0.0.1:${modelPort}/v1`, api: 'openai-completions', apiKey: 'local-fixture-only',
  models: [{ id: 'fixture', name: 'Local delegation fixture', reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 4096 }] } } }));
function startGateway() {
const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/bin.ts', 'gateway', '--port', String(port), '--bind', 'loopback', '--no-hot-reload'], {
  env: { PATH: process.env.PATH, XOPC_STATE_DIR: directory, XOPC_WORKSPACE: workspace, XOPC_CONFIG_PATH: config, XOPC_CONFIG: config,
    XOPC_UI_STATIC_ROOT: process.env.XOPC_SMOKE_UI_ROOT, XOPC_MODELS_JSON: modelsPath, XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1', XOPC_LOG_LEVEL: 'fatal' },
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
  const operations = (await request('/api/capabilities/operations')).capabilities;
  async function operate(id: string, input: unknown) {
    const descriptor = operations.find((item: { id: string }) => item.id === id);
    return (await request(`/api/capabilities/operations/${id}/invocations`, 'POST', { majorVersion: descriptor.majorVersion,
      descriptorDigest: descriptor.descriptorDigest, input, idempotencyKey: crypto.randomUUID() })).data;
  }
  const main = (await operate('xopc.agents.get', { id: 'main' })).agent;
  await operate('xopc.agents.update', { id: 'main', expectedRevision: main.revision, patch: { models: { chat: { primary: 'delegation-fixture/fixture', fallbacks: [] } } } });
  const note = (await operate('xopc.notes.create', { title: 'Delegation approved note', markdown: 'APPROVED RESOURCE CONTENT' })).note;
  const privateNote = (await operate('xopc.notes.create', { title: 'Private note', markdown: 'PRIVATE RESOURCE CONTENT' })).note;
  const { app } = await request('/api/local-apps', 'POST', { name: 'Safe delegation fixture', idea: 'Review explicit approved context' });
  const catalog = (await request('/api/local-app-capabilities/catalog')).capabilities;
  const manifestPath = join(app.workspaceRoot, 'xopc.extension.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.ui.capabilities = catalog.filter((item: { id: string }) => ['xopc.agent.delegate', 'xopc.notes.get'].includes(item.id)).map(({ id, majorVersion, descriptorDigest }: Record<string, unknown>) => ({ id, majorVersion, descriptorDigest }));
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(join(app.workspaceRoot, '.xopc', 'acceptance.json'), JSON.stringify({ schemaVersion: 1, scenarios: [{ id: 'ready', name: 'Ready', steps: [{ action: 'click', target: 'ready' }, { assert: 'text_visible', text: 'Ready for review' }] }] }));
  writeFileSync(join(app.workspaceRoot, 'ui', 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Safe delegation</title><link rel="stylesheet" href="./styles.css"></head><body><main class="hero"><h1>Safe delegation fixture</h1>
    <p>Review one explicitly approved note. No tools or automatic writes.</p><button data-xopc-test-id="ready" disabled>Check readiness</button><p id="ready"></p>
    <label>Instruction<input aria-label="Instruction" value="Summarize the approved note"></label><button id="delegate" disabled>Delegate review</button><output aria-live="polite"></output>
    </main><script type="module" src="./app.js"></script></body></html>`);
  const application = `import { createExtensionClient } from ${JSON.stringify(join(process.cwd(), 'packages/extension-ui-sdk/src/index.ts'))};
    const client = createExtensionClient(); await client.whenReady();
    const ready = document.querySelector('[data-xopc-test-id="ready"]'); ready.onclick = () => document.querySelector('#ready').textContent = 'Ready for review'; ready.disabled = false;
    const button = document.querySelector('#delegate'); const keys = new Map();
    button.onclick = async () => { button.disabled = true; const instruction = document.querySelector('input').value; document.querySelector('output').textContent = 'Working';
      try { const descriptor = await client.capability.describe('xopc.agent.delegate');
        if (!keys.has(instruction)) keys.set(instruction, crypto.randomUUID());
        const result = await client.capability.call('xopc.agent.delegate', { majorVersion: descriptor.majorVersion, descriptorDigest: descriptor.descriptorDigest,
          idempotencyKey: keys.get(instruction), input: { instruction, sources: [{ capabilityId: 'xopc.notes.get', id: ${JSON.stringify(note.id)} }] } });
        document.querySelector('output').textContent = result.data.text;
      } catch (error) { document.querySelector('output').textContent = 'Error: ' + error.message; } finally { button.disabled = false; }
    }; button.disabled = false;`;
  await build({ stdin: { contents: application, resolveDir: process.cwd(), sourcefile: 'delegation-fixture.ts', loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', outfile: join(app.workspaceRoot, 'ui', 'app.js'), logLevel: 'silent' });
  browser = await chromium.launch({ executablePath: process.env.XOPC_SMOKE_BROWSER ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext();
  const login = await context.request.post(`${origin}/api/browser-session`, { headers: { Authorization: `Bearer ${token}`, Origin: origin } }); assert.ok(login.ok());
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(30000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('button', { name: /^(Maybe later, keep using my current model|暂时不用，继续使用现有模型)$/ }).click({ timeout: 6000 }).catch(() => {});
  if (await page.locator('.xopc-onboarding-dialog').waitFor({ timeout: 1500 }).then(() => true, () => false)) await page.keyboard.press('Escape');
  await page.addLocatorHandler(page.getByRole('button', { name: /^(Maybe later, keep using my current model|暂时不用，继续使用现有模型)$/ }), async button => button.click());
  await page.addLocatorHandler(page.locator('.xopc-onboarding-dialog'), async () => { await page.keyboard.press('Escape'); });
  await page.goto(`${origin}/#/local-apps/${app.id}`);
  await page.getByRole('button', { name: /^(Add to sidebar|添加到左侧导航)$/ }).waitFor();
  const preview = page.frameLocator('iframe[title$=" preview"]');
  await preview.getByRole('button', { name: 'Delegate review' }).click();
  await preview.getByText(/^Error:/).waitFor(); assert.equal(modelRequests.length, 0);
  console.log('PASS: preview delegation is unavailable without a provider submission.');
  await page.getByRole('button', { name: /^(Add to sidebar|添加到左侧导航)$/ }).click();
  await Promise.all([page.waitForResponse(response => response.url().endsWith(`/api/local-apps/${app.id}/install`) && response.ok()), page.getByRole('dialog').getByRole('button', { name: /^(Install|确认安装)$/ }).click()]);
  async function review(consent: boolean) {
    await page.evaluate(() => { location.hash = '#/local-apps'; });
    await page.waitForFunction(() => document.querySelectorAll('iframe').length === 0);
    await page.evaluate(id => { location.hash = `#/extensions/${id}`; }, app.extensionId);
    const dialog = page.getByRole('dialog');
    const consentBox = dialog.getByRole('checkbox', { name: /^(Allow sending app instructions|允许发送应用指令)/ });
    assert.equal(await consentBox.isChecked(), false, 'Delegation must default to denied');
    const group = dialog.getByRole('group', { name: /^(Notes this app may read|读取笔记的范围)$/ });
    await group.getByRole('button', { name: /^(Notes this app may read|读取笔记的范围)$/ }).click();
    await page.getByRole('button', { name: /^(Selected records or projects|仅选择的记录或项目)$/ }).click();
    await group.getByRole('checkbox', { name: 'Delegation approved note', exact: true }).check();
    if (consent) await consentBox.check();
    const reviewEvidence = process.env.XOPC_SMOKE_ARTIFACT_DIR ?? join(tmpdir(), 'xopc-local-app-delegation-evidence'); mkdirSync(reviewEvidence, { recursive: true });
    await page.screenshot({ path: join(reviewEvidence, consent ? 'delegation-approved-scope.png' : 'delegation-default-denied.png') });
    await dialog.getByRole('button', { name: /^(Allow|允许)$/ }).click();
    await page.frameLocator('iframe').first().getByRole('button', { name: 'Delegate review' }).waitFor();
    return (await request(`/api/extensions/${app.extensionId}/ui-grant`)).grant;
  }
  const installedFrame = () => page.frameLocator('iframe').first();
  const firstGrant = await review(false);
  await installedFrame().getByRole('button', { name: 'Delegate review' }).click();
  await installedFrame().getByText(/^Error:/).waitFor(); assert.equal(modelRequests.length, 0);
  await request(`/api/extensions/${app.extensionId}/ui-grant`, 'DELETE', { manifestDigest: firstGrant.manifestDigest });
  const grant = await review(true);
  await installedFrame().getByRole('button', { name: 'Delegate review' }).click();
  await installedFrame().getByText('Delegated result: reviewed the approved note.', { exact: true }).waitFor();
  assert.equal(modelRequests.length, 1);
  const modelRequest = modelRequests[0];
  assert.equal(modelRequest.messages.length, 2); assert.ok(!modelRequest.tools?.length);
  assert.ok((modelRequest.max_tokens ?? modelRequest.max_completion_tokens) <= 1024);
  assert.ok(JSON.stringify(modelRequest).includes('APPROVED RESOURCE CONTENT')); assert.ok(!JSON.stringify(modelRequest).includes('PRIVATE RESOURCE CONTENT'));
  await installedFrame().getByRole('button', { name: 'Delegate review' }).click();
  await installedFrame().getByText('Delegated result: reviewed the approved note.', { exact: true }).waitFor(); assert.equal(modelRequests.length, 1);
  console.log('PASS: real SDK/browser denies previews and default consent, scoped approved inference uses the host-selected model without tools/history, and stable retry incurs one provider call.');
  const descriptor = catalog.find((item: { id: string }) => item.id === 'xopc.agent.delegate');
  const body = (input: unknown, key = crypto.randomUUID()) => ({ manifestDigest: grant.manifestDigest, grantRevision: grant.grantRevision,
    call: { majorVersion: descriptor.majorVersion, descriptorDigest: descriptor.descriptorDigest, idempotencyKey: key, input } });
  const invokePath = `/api/local-app-capabilities/${app.extensionId}/xopc.agent.delegate/invocations`;
  const raw = (input: unknown, key?: string) => fetch(`${origin}${invokePath}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body(input, key)) });
  assert.equal((await fetch(`${origin}${invokePath}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body({ instruction: 'No authentication' })) })).status, 401);
  assert.equal((await raw({ instruction: 'Private', sources: [{ capabilityId: 'xopc.notes.get', id: privateNote.id }] })).status, 403);
  for (const extra of [{ tools: ['bash'] }, { model: 'other' }, { agentId: 'main' }, { conversationId: crypto.randomUUID() }, { sources: [{ capabilityId: 'xopc.agent.delegate', id: 'recursive' }] }]) {
    assert.equal((await raw({ instruction: 'Escalate', ...extra })).status, 400);
  }
  assert.equal(modelRequests.length, 1);
  const evidence = process.env.XOPC_SMOKE_ARTIFACT_DIR ?? join(tmpdir(), 'xopc-local-app-delegation-evidence'); mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, 'delegation-result.png') });
  await installedFrame().getByRole('textbox', { name: 'Instruction' }).fill('HOLD REQUEST');
  await installedFrame().getByRole('button', { name: 'Delegate review' }).click();
  for (let i = 0; i < 200 && !holdResponse; i++) await page.waitForTimeout(25);
  assert.ok(holdResponse); assert.equal(modelRequests.length, 2);
  await request(`/api/extensions/${app.extensionId}/ui-grant`, 'DELETE', { manifestDigest: grant.manifestDigest });
  holdResponse();
  await installedFrame().getByText(/^Error:/).waitFor();
  assert.equal((await raw({ instruction: 'Revoked' })).status, 403);
  assert.equal(modelRequests.length, 2);
  // Read via the ordinary product contract, with no extension authority.
  const noteContract = operations.find((item: { id: string }) => item.id === 'xopc.notes.get');
  const current = (await request('/api/capabilities/operations/xopc.notes.get/invocations', 'POST', { majorVersion: noteContract.majorVersion, descriptorDigest: noteContract.descriptorDigest, input: { id: note.id } })).data.note;
  assert.equal(current.markdown, 'APPROVED RESOURCE CONTENT');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(evidence, 'delegation-revoked.png') });
  console.log('PASS: real authenticated Gateway rejects out-of-scope references, model/tool/session/recursive escalation and unauthenticated callers; revocation withholds in-flight output and leaves production notes unchanged.');
  await review(true); holdResponse = undefined;
  await installedFrame().getByRole('textbox', { name: 'Instruction' }).fill('HOLD REQUEST');
  await installedFrame().getByRole('button', { name: 'Delegate review' }).click();
  for (let i = 0; i < 200 && !holdResponse; i++) await page.waitForTimeout(25);
  assert.ok(holdResponse); assert.equal(modelRequests.length, 3);
  const stopped = page.waitForResponse(response => response.url().endsWith('/xopc.agent.delegate/invocations') && response.request().method() === 'POST');
  const loggedOut = await context.request.delete(`${origin}/api/browser-session`, { headers: { Origin: origin } }); assert.ok(loggedOut.ok());
  (holdResponse as () => void)();
  const withheld = await stopped; assert.equal(withheld.status(), 409);
  assert.equal((await withheld.json()).code, 'OUTCOME_UNKNOWN');
  assert.equal(modelRequests.length, 3);
  console.log('PASS: ending the real browser session invalidates in-flight delegation before returning model output.');
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
  modelServer.closeAllConnections(); await new Promise<void>(resolve => modelServer.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
}
