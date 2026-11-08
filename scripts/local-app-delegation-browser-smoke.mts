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
    chunk({ role: 'assistant', content: JSON.stringify(body.messages).includes('STRUCTURED REQUEST') ? '{\"items\":[\"reviewed\"]}' : 'Delegated result: reviewed the approved note.' }, null);
    chunk({}, 'stop'); res.end('data: [DONE]\n\n');
  };
  if (delegation && JSON.stringify(body.messages).includes('HOLD REQUEST')) holdResponse = finish; else finish();
});
await new Promise<void>(resolve => modelServer.listen(0, '127.0.0.1', resolve));
const modelPort = (modelServer.address() as { port: number }).port;
const modelsPath = join(directory, 'models.json');
writeFileSync(modelsPath, JSON.stringify({ providers: { 'delegation-fixture': { baseUrl: `http://127.0.0.1:${modelPort}/v1`, api: 'openai-completions', apiKey: 'local-fixture-only',
  models: [{ id: 'fixture', name: 'Local delegation fixture', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096 }] } } }));
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
  const automation = (await operate('xopc.automations.create', { name: 'Approved execution fixture', enabled: true, trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'Return a short status. Do not use tools.' }, safety: { mode: 'suggest_only' }, delivery: { notificationPolicy: 'none', destinations: [] } })).automation;
  const { app } = await request('/api/local-apps', 'POST', { name: 'Safe delegation fixture', idea: 'Review explicit approved context' });
  const catalog = (await request('/api/local-app-capabilities/catalog')).capabilities;
  const manifestPath = join(app.workspaceRoot, 'xopc.extension.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.ui.capabilities = catalog.filter((item: { id: string }) => ['xopc.agent.delegate', 'xopc.notes.get', 'xopc.automations.list', 'xopc.automations.get', 'xopc.automations.run', 'xopc.automations.get_run', 'xopc.automations.cancel', 'xopc.automations.history', 'xopc.automations.run_events', 'xopc.automations.simulate', 'xopc.automations.propose', 'xopc.automations.get_proposal'].includes(item.id)).map(({ id, majorVersion, descriptorDigest }: Record<string, unknown>) => ({ id, majorVersion, descriptorDigest }));
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(join(app.workspaceRoot, '.xopc', 'acceptance.json'), JSON.stringify({ schemaVersion: 1, scenarios: [{ id: 'ready', name: 'Ready', steps: [{ action: 'click', target: 'ready' }, { assert: 'text_visible', text: 'Ready for review' }] }] }));
  writeFileSync(join(app.workspaceRoot, 'ui', 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Safe delegation</title><link rel="stylesheet" href="./styles.css"></head><body><main class="hero"><h1>Safe delegation fixture</h1>
    <p>Review one explicitly approved note. No tools or automatic writes.</p><button data-xopc-test-id="ready" disabled>Check readiness</button><p id="ready"></p>
    <label>Instruction<input aria-label="Instruction" value="Summarize the approved note"></label><button id="delegate" disabled>Delegate review</button><output aria-live="polite"></output><button id="run-automation" disabled>Run approved automation</button><output id="automation-result"></output><button id="recover-run" disabled>Recover latest run</button><output id="recovered-run"></output><button id="propose" disabled>Propose automation</button><output id="proposal-result"></output>
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
    }; button.disabled = false;
    const runButton = document.querySelector('#run-automation');
    runButton.onclick = async () => { runButton.disabled = true; document.querySelector('#automation-result').textContent = 'Working';
      try {
        const invoke = async (id, input, key) => { const contract = await client.capability.describe(id);
          return (await client.capability.call(id, { majorVersion: contract.majorVersion, descriptorDigest: contract.descriptorDigest, input, ...(key ? { idempotencyKey: key } : {}) })).data; };
        const list = await invoke('xopc.automations.list', {});
        if (list.items.length !== 1) throw new Error('Unexpected automation scope');
        const detail = await invoke('xopc.automations.get', { id: list.items[0].id });
        if (detail.automation.action) throw new Error('Execution details leaked');
        const queued = await invoke('xopc.automations.run', { id: detail.automation.id }, 'browser-execution');
        let finish;
        const terminal = new Promise(resolve => { finish = resolve; });
        const stop = await client.automation.watchRun(queued.run.id, update => {
          if (update.type === 'error') { document.querySelector('#automation-result').textContent = 'Error: ' + update.message; finish(); return; }
          document.querySelector('#automation-result').textContent = 'Automation result: ' + update.run.status;
          if (!['queued', 'running', 'cancelling'].includes(update.run.status)) finish();
        });
        await terminal; stop();
      } catch (error) { document.querySelector('#automation-result').textContent = 'Error: ' + error.message; }
      finally { runButton.disabled = false; }
    }; runButton.disabled = false;
    const invoke = async (id, input, key) => { const contract = await client.capability.describe(id);
      return (await client.capability.call(id, { majorVersion: contract.majorVersion, descriptorDigest: contract.descriptorDigest, input, ...(key ? { idempotencyKey: key } : {}) })).data; };
    const recover = document.querySelector('#recover-run'); recover.disabled = false;
    recover.onclick = async () => { try { const result = await invoke('xopc.automations.history', { limit: 1 });
      document.querySelector('#recovered-run').textContent = 'Recovered run: ' + result.items[0].status;
    } catch (error) { document.querySelector('#recovered-run').textContent = 'Error: ' + error.message; } };
    const propose = document.querySelector('#propose'); propose.disabled = false;
    propose.onclick = async () => { try {
      const definition = { name: 'App proposed workflow', enabled: true, trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'Return a concise review.' }, safety: { mode: 'suggest_only' }, delivery: { notificationPolicy: 'none', destinations: [] } };
      const simulation = await invoke('xopc.automations.simulate', definition);
      if (!simulation.simulation.actionSummary) throw new Error('Simulation is missing');
      const proposal = await invoke('xopc.automations.propose', { kind: 'create', definition }, 'browser-proposal');
      document.querySelector('#proposal-result').textContent = 'Proposal pending: ' + proposal.id;
      await client.automation.reviewProposal(proposal.id);
    } catch (error) { document.querySelector('#proposal-result').textContent = 'Error: ' + error.message; } };
    `;
  await build({ stdin: { contents: application, resolveDir: process.cwd(), sourcefile: 'delegation-fixture.ts', loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', outfile: join(app.workspaceRoot, 'ui', 'app.js'), logLevel: 'silent' });
  browser = await chromium.launch({ executablePath: process.env.XOPC_SMOKE_BROWSER ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext();
  const login = await context.request.post(`${origin}/api/browser-session`, { headers: { Authorization: `Bearer ${token}`, Origin: origin } }); assert.ok(login.ok());
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(30000);
  let runStreams = 0;
  page.on('request', req => { if (/\/runs\/[^/]+\/events\?/.test(req.url())) runStreams++; });
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
  await preview.locator('output[aria-live="polite"]').filter({ hasText: /^Error:/ }).waitFor(); assert.equal(modelRequests.length, 0);
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
    const automationRead = dialog.getByRole('group', { name: /^(Automations this app may read|读取自动化的范围)$/ });
    await automationRead.getByRole('button', { name: /^(Automations this app may read|读取自动化的范围)$/ }).click();
    await page.getByRole('button', { name: /^(Selected records or projects|仅选择的记录或项目)$/ }).click();
    await automationRead.getByRole('checkbox', { name: 'Approved execution fixture', exact: true }).check();
    if (consent) {
      await consentBox.check();
      await dialog.getByRole('checkbox', { name: /^(Allow simulation and automation proposals|允许模拟和提交自动化提案)/ }).check();
      const execution = dialog.getByRole('group', { name: /^(Approved automation execution|允许执行的自动化)$/ });
      await execution.locator('summary').filter({ hasText: 'Approved execution fixture' }).click();
      await execution.getByRole('checkbox', { name: /^(Allow model processing|允许模型处理)/ }).check();
      await execution.getByRole('checkbox', { name: /^(Allow this app to run this configuration|允许此应用运行以上配置)$/ }).check();
    }
    const reviewEvidence = process.env.XOPC_SMOKE_ARTIFACT_DIR ?? join(tmpdir(), 'xopc-local-app-delegation-evidence'); mkdirSync(reviewEvidence, { recursive: true });
    await page.screenshot({ path: join(reviewEvidence, consent ? 'delegation-approved-scope.png' : 'delegation-default-denied.png') });
    await dialog.getByRole('button', { name: /^(Allow|允许)$/ }).click();
    await page.frameLocator('iframe').first().getByRole('button', { name: 'Delegate review' }).waitFor();
    return (await request(`/api/extensions/${app.extensionId}/ui-grant`)).grant;
  }
  const installedFrame = () => page.frameLocator('iframe').first();
  const firstGrant = await review(false);
  await installedFrame().getByRole('button', { name: 'Delegate review' }).click();
  await installedFrame().locator('output[aria-live="polite"]').filter({ hasText: /^Error:/ }).waitFor(); assert.equal(modelRequests.length, 0);
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
  await installedFrame().getByRole('button', { name: 'Run approved automation' }).click();
  await installedFrame().getByText(/^Automation result: (succeeded|failed|cancelled|timeout)$/).waitFor();
  const executionCheck = await operate('xopc.automations.history', { automationId: automation.id });
  assert.equal(executionCheck.items[0]?.status, 'succeeded', JSON.stringify(executionCheck.items[0]));
  await installedFrame().getByRole('button', { name: 'Run approved automation' }).click();
  await installedFrame().getByText('Automation result: succeeded', { exact: true }).waitFor();
  const history = await operate('xopc.automations.history', { automationId: automation.id });
  assert.equal(history.items.length, 1, 'Repeated app intent must not submit another execution');
  assert.ok(runStreams >= 1, 'SDK must use the authorized event stream');
  await page.evaluate(() => { location.hash = '#/local-apps'; });
  await page.waitForFunction(() => document.querySelectorAll('iframe').length === 0);
  await page.evaluate(id => { location.hash = `#/extensions/${id}`; }, app.extensionId);
  await installedFrame().getByRole('button', { name: 'Recover latest run' }).click();
  await installedFrame().getByText('Recovered run: succeeded', { exact: true }).waitFor();
  await installedFrame().getByRole('button', { name: 'Propose automation' }).click();
  const proposalDialog = page.getByRole('dialog', { name: /^(Review app automation proposal|审核应用提出的自动化)$/ });
  await proposalDialog.getByText('App proposed workflow', { exact: false }).waitFor();
  const beforeAdoption = await operate('xopc.automations.list', {});
  assert.equal(beforeAdoption.items.some((item: { name: string }) => item.name === 'App proposed workflow'), false);
  const reviewApplied = page.waitForResponse(response => /automation-proposals\/[^/]+\/review$/.test(response.url()) && response.ok());
  await proposalDialog.getByRole('button', { name: /^(Approve proposal|确认采用)$/ }).click();
  await reviewApplied;
  const adopted = (await operate('xopc.automations.list', {})).items.find((item: { name: string }) => item.name === 'App proposed workflow');
  assert.ok(adopted); assert.equal(adopted.enabled, false, 'Host adoption must default to disabled');
  console.log('PASS: SDK event subscription, app reopen recovery, pure simulation and host-only proposal adoption work through the authenticated lazy routes.');
  const invokeAutomation = (command: string, input: unknown, key = crypto.randomUUID()) => {
    const contract = catalog.find((item: { id: string }) => item.id === `xopc.automations.${command}`);
    return fetch(`${origin}/api/local-app-capabilities/${app.extensionId}/${contract.id}/invocations`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifestDigest: grant.manifestDigest, grantRevision: grant.grantRevision,
        call: { majorVersion: contract.majorVersion, descriptorDigest: contract.descriptorDigest, idempotencyKey: key, input } }),
    });
  };
  assert.equal((await invokeAutomation('cancel', { id: history.items[0].id })).status, 200);
  assert.equal((await invokeAutomation('cancel', { id: crypto.randomUUID() })).status, 403);
  assert.equal((await invokeAutomation('run', { id: automation.id, action: { instruction: 'Change execution' } })).status, 400);
  const currentAutomation = (await operate('xopc.automations.get', { id: automation.id })).automation;
  await operate('xopc.automations.update', { id: automation.id, expectedRevision: currentAutomation.updatedAtMs,
    patch: { action: { kind: 'agent', instruction: 'Changed configuration requires a new review.' } } });
  assert.equal((await invokeAutomation('run', { id: automation.id }, 'browser-execution')).status, 403);
  assert.equal((await invokeAutomation('run', { id: automation.id })).status, 403);
  const staleApproval = await fetch(`${origin}/api/extensions/${app.extensionId}/ui-grant`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifestDigest: grant.manifestDigest, resourceScopes: grant.resourceScopes }),
  });
  assert.equal(staleApproval.status, 409);
  console.log('PASS: real SDK/browser reviews a specific automation configuration, executes it through the existing Agent runtime, reads its result and replays without resubmission.');
  console.log('PASS: real Gateway rejects injected execution inputs, foreign-run cancellation, changed configurations and stale approval digests.');
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
  const structured = await raw({ instruction: 'STRUCTURED REQUEST', responseFormat: 'json', maxOutputTokens: 4096 });
  assert.equal(structured.status, 200);
  assert.deepEqual((await structured.json()).data.json, { items: ['reviewed'] });
  assert.equal(modelRequests.length, 2);
  console.log('PASS: real provider transport returns validated JSON through the pinned delegation contract.');
  const evidence = process.env.XOPC_SMOKE_ARTIFACT_DIR ?? join(tmpdir(), 'xopc-local-app-delegation-evidence'); mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, 'delegation-result.png') });
  await installedFrame().getByRole('textbox', { name: 'Instruction' }).fill('HOLD REQUEST');
  await installedFrame().getByRole('button', { name: 'Delegate review' }).click();
  for (let i = 0; i < 200 && !holdResponse; i++) await page.waitForTimeout(25);
  assert.ok(holdResponse); assert.equal(modelRequests.length, 3);
  await request(`/api/extensions/${app.extensionId}/ui-grant`, 'DELETE', { manifestDigest: grant.manifestDigest });
  holdResponse();
  await installedFrame().locator('output[aria-live="polite"]').filter({ hasText: /^Error:/ }).waitFor();
  assert.equal((await raw({ instruction: 'Revoked' })).status, 403);
  assert.equal(modelRequests.length, 3);
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
  assert.ok(holdResponse); assert.equal(modelRequests.length, 4);
  const stopped = page.waitForResponse(response => response.url().endsWith('/xopc.agent.delegate/invocations') && response.request().method() === 'POST');
  const loggedOut = await context.request.delete(`${origin}/api/browser-session`, { headers: { Origin: origin } }); assert.ok(loggedOut.ok());
  (holdResponse as () => void)();
  const withheld = await stopped; assert.equal(withheld.status(), 409);
  assert.equal((await withheld.json()).code, 'OUTCOME_UNKNOWN');
  assert.equal(modelRequests.length, 4);
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
