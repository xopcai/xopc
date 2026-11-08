import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Browser } from 'playwright-core';

import { AgentDefaultsSchema } from '../src/agent-config/schema.js';
import { seedTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { ConfigSchema } from '../src/config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../src/storage/sqlite/connection.js';
import { ensureSessionRecord } from '../src/storage/sqlite/session-repository.js';

const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');
const root = await mkdtemp(join(tmpdir(), 'xopc-tool-approval-browser-'));
const evidence = resolve(process.env.XOPC_APPROVAL_EVIDENCE ?? '/tmp/xopc-tool-approval-browser');
await mkdir(evidence, { recursive: true });
const phases = ['approve', 'deny', 'expire'] as const;
type Phase = typeof phases[number];
const conversations = Object.fromEntries(phases.map(phase => [phase, randomUUID()])) as Record<Phase, string>;
const observed = { requests: 0, requestedExecutions: [] as string[], errors: [] as string[] };
const marker = (phase: Phase) => join(root, `${phase}.executed`);
async function executionCount(phase: Phase) {
  try { return (await readFile(marker(phase), 'utf8')).split('\n').filter(Boolean).length; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
}
const model = createServer(async (req, res) => {
  try {
    let source = ''; for await (const chunk of req) source += chunk;
    const body = JSON.parse(source), text = JSON.stringify(body.messages ?? []);
    const tools = (body.tools ?? []).map((tool: { function?: unknown }) => tool.function ?? tool) as Array<{ name: string }>;
    const phase = /APPROVAL_E2E_(approve|deny|expire)/.exec(text)?.[1] as Phase | undefined;
    observed.requests++;
    let calls: unknown[] | undefined;
    let content = 'Approval test response';
    if (phase && tools.length) {
      if (await executionCount(phase)) content = `APPROVAL_E2E_COMPLETE_${phase}`;
      else {
        const tool = tools.find(tool => tool.name === 'exec_command');
        assert(tool, `exec_command is unavailable: ${tools.map(tool => tool.name).join(',')}`);
        // The model intentionally requests execution again after denial; the host must block it.
        const cmd = `node -e "require('node:fs').appendFileSync('${phase}.executed','EXECUTED\\n')"`;
        calls = [{ index: 0, id: 'call_' + randomUUID().replaceAll('-', ''), type: 'function', function: { name: tool.name, arguments: JSON.stringify({ cmd }) } }];
        observed.requestedExecutions.push(phase);
      }
    }
    const envelope = { id: randomUUID(), object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'approval-lab', choices: [{ index: 0, delta: calls ? { role: 'assistant', tool_calls: calls } : { role: 'assistant', content }, finish_reason: null }] };
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    res.write(`data: ${JSON.stringify(envelope)}\n\n`);
    res.write(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta: {}, finish_reason: calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  } catch (error) { observed.errors.push(String(error)); res.writeHead(500).end(); }
});
model.listen(0, '127.0.0.1'); await once(model, 'listening');
const modelAddress = model.address(); assert(modelAddress && typeof modelAddress !== 'string');
const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
const address = listener.address(); assert(address && typeof address !== 'string');
const port = address.port; await new Promise<void>(resolve => listener.close(() => resolve()));
const base = `http://127.0.0.1:${port}`, token = randomUUID();
Object.assign(process.env, { XOPC_STATE_DIR: root, XOPC_CONFIG_PATH: join(root, 'xopc.json'), XOPC_WORKSPACE: root,
  PI_CODING_AGENT_DIR: join(root, 'pi'), XOPC_LOG_LEVEL: 'warn', XOPC_LOG_CONSOLE: 'false' });
await writeFile(join(root, 'xopc.json'), JSON.stringify(ConfigSchema.parse({ gateway: { port, auth: { mode: 'token', token } } })));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { 'approval-lab': { baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`, api: 'openai-completions', apiKey: 'synthetic-test-key', models: [{ id: 'lab', name: 'Approval controlled model', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 2048 }] } } }));
const route = { primary: 'approval-lab/lab', fallbacks: [] };
openXopcDatabase();
seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: route, background: route,
  intents: Object.fromEntries(['fast', 'reasoning', 'coding', 'review', 'vision', 'understanding'].map(key => [key, route])) }, runtime: { maxTurns: 6, timeoutMs: 90000 } }),
  agents: [{ id: 'main', enabled: true, workspace: root, toolAllowlist: ['exec_command'], profile: { name: 'Main' } }], surfaceDefaults: { chat: 'main' } });
for (const phase of phases) ensureSessionRecord(conversations[phase], root, { agentId: 'main', sourceChannel: 'webchat', name: `Approval ${phase}` });
closeXopcDatabase();
const child = spawn(process.execPath, ['--import', 'tsx/esm', 'src/cli/bin.ts', 'gateway', '--port', String(port), '--no-hot-reload'], { cwd: resolve('.'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '', browser: Browser | undefined;
const pageErrors: string[] = [], submissions: unknown[] = [], checks: string[] = [];
child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null) throw new Error(`Gateway exited: ${logs.slice(-3000)}`);
    try { if ((await fetch(base + '/health', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(ready, logs.slice(-3000));
  browser = await chromium.launch({ headless: true, channel: process.env.XOPC_BROWSER_CHANNEL || 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, locale: 'en-US' });
  await context.addInitScript(() => localStorage.setItem('xopc.language', 'en'));
  const auth = await context.request.post(base + '/api/browser-session', { headers: { Authorization: `Bearer ${token}`, Origin: base, 'Sec-Fetch-Site': 'same-origin' } });
  assert(auth.ok(), `${auth.status()}: ${await auth.text()}`);
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' && /\/clarifications\/.+\/responses$/.test(new URL(request.url()).pathname)) submissions.push(request.postDataJSON()); });
  async function dismissOnboarding() {
    for (let attempt = 0; attempt < 30; attempt++) {
      for (const name of ['Maybe later, keep using my current model', 'Skip for now']) {
        const button = page.getByRole('button', { name, exact: true }); if (await button.isVisible()) await button.click({ timeout: 1000 }).catch(() => {});
      }
      if (!(await page.getByRole('dialog').count())) return;
      await page.waitForTimeout(200);
    }
  }
  await page.goto(base + '/#/chat');
  await dismissOnboarding();
  await page.locator('[contenteditable="true"]').first().waitFor();
  await page.evaluate(() => { location.hash = '#/settings/agent-defaults?panel=tools'; });
  await page.getByRole('heading', { name: 'Agent settings', exact: true }).waitFor();
  console.log('Web settings opened');
  const policy = page.getByRole('group', { name: 'exec_command', exact: true });
  await policy.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByRole('heading', { name: 'Agent settings', exact: true }).click();
  await assert.doesNotReject(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await context.request.get(base + '/api/global-defaults');
      const body = await response.json();
      if (body.payload?.defaults?.tools?.exec_command?.mode === 'ask') return;
      await page.waitForTimeout(100);
    }
    throw new Error('Web Ask setting did not persist');
  });
  await page.screenshot({ path: join(evidence, 'settings-ask.png') }); console.log('Ask setting persisted'); checks.push('Ask configured through the real Web settings and persisted');
  for (const phase of phases) {
    await page.goto(`${base}/#/chat/${conversations[phase]}`); await dismissOnboarding();
    await page.evaluate(id => { location.hash = `#/chat/${id}`; }, conversations[phase]);
    await page.waitForURL(`${base}/#/chat/${conversations[phase]}`);
    await page.getByRole('heading', { name: `Approval ${phase}`, exact: true }).waitFor();
    const composer = page.locator('[contenteditable="true"]').first(); await composer.waitFor();
    await composer.click(); await page.keyboard.insertText(`APPROVAL_E2E_${phase}: run the requested command.`);
    const sent = page.waitForRequest(request => request.method() === 'POST' && /\/inputs$/.test(new URL(request.url()).pathname));
    await composer.press('Enter');
    assert.equal(new URL((await sent).url()).pathname, `/api/sessions/${conversations[phase]}/inputs`, 'Input must belong to the visible conversation');
    const card = page.locator('section[data-clarification-id]').filter({ has: page.getByRole('button', { name: 'Approve this operation', exact: true }) });
    await card.waitFor(); console.log(`Approval card visible: ${phase}`);
    await page.waitForTimeout(800);
    assert.equal(await executionCount(phase), 0, `${phase}: command ran before approval`);
    assert.equal(await page.getByText('User did not approve exec_command.', { exact: true }).count(), 0, 'Waiting must not be rendered as a user denial');
    assert.equal(await page.getByRole('button', { name: /^Execution failed/ }).count(), 0, 'Waiting must not be rendered as execution failure');
    await page.getByText('Waiting for approval', { exact: true }).first().waitFor();
    assert.equal(await page.getByText('Ran commands', { exact: true }).count(), 0, 'Pending approval must not claim execution');
    const waitId = await card.getAttribute('data-clarification-id'); assert(waitId);
    await page.reload(); await card.waitFor();
    await page.getByText('Waiting for approval', { exact: true }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: /^Execution failed/ }).count(), 0, 'Persisted waiting state must survive reload');
    assert.equal(await executionCount(phase), 0, 'Reloading must not execute an unapproved command');
    await page.screenshot({ path: join(evidence, `${phase}-pending.png`) });
    checks.push(`${phase}: actual tool call shows approval card and has not executed`);
    if (phase === 'expire') {
      // Accelerate only this isolated fixture's persisted deadline; production TTL stays unchanged.
      const db = new DatabaseSync(join(root, 'xopc.db'));
      const row = db.prepare('SELECT data_json FROM session_clarification_waits WHERE id = ?').get(waitId) as { data_json: string };
      const wait = JSON.parse(row.data_json); wait.expiresAt = Date.now() + 6000;
      db.prepare('UPDATE session_clarification_waits SET data_json = ? WHERE id = ?').run(JSON.stringify(wait), waitId); db.close();
      await page.reload(); await card.waitFor();
      await page.waitForFunction(id => {
        const element = document.querySelector(`section[data-clarification-id="${id}"]`);
        if (!element) return true;
        return element.textContent?.includes('This approval has expired.') && Array.from(element.querySelectorAll('button')).filter(button => button.textContent?.includes('Approve this operation')).every(button => button.disabled);
      }, waitId, { timeout: 15000 });
      await page.waitForTimeout(250);
      const late = await context.request.post(`${base}/api/clarifications/${waitId}/responses`, { data: { action: 'answer', decision: 'approve', expectedVersion: wait.version, idempotencyKey: randomUUID() }, headers: { Origin: base, 'Sec-Fetch-Site': 'same-origin' } });
      assert.equal(late.status(), 409, 'Expired approval must be rejected by the server');
      assert.equal(await executionCount(phase), 0);
      checks.push('Timeout disables approval; server rejects late approval; no execution');
    } else {
      const decision = phase === 'approve' ? 'Approve this operation' : 'Deny this operation';
      const accepted = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/clarifications/${waitId}/responses`);
      await card.getByRole('button', { name: decision, exact: true }).click(); assert.equal((await accepted).status(), 202);
      if (phase === 'approve') {
        await page.getByText('APPROVAL_E2E_COMPLETE_approve', { exact: false }).waitFor({ timeout: 60000 });
        assert.equal(await executionCount(phase), 1, 'Approved operation executes once');
        checks.push('Approval resumes real execution exactly once');
      } else {
        let consumed = false;
        for (let attempt = 0; attempt < 150; attempt++) {
          const db = new DatabaseSync(join(root, 'xopc.db'), { readOnly: true });
          const row = db.prepare('SELECT data_json FROM session_clarification_waits WHERE id = ?').get(waitId) as { data_json: string };
          const wait = JSON.parse(row.data_json); db.close();
          if (wait.approvalConsumedAt) { consumed = true; break; }
          await page.waitForTimeout(100);
        }
        assert(consumed, 'Denial did not reach the host execution gate');
        await page.waitForTimeout(500); assert.equal(await executionCount(phase), 0);
        checks.push('Denial prevents actual execution');
      }
    }
    await page.screenshot({ path: join(evidence, `${phase}-completed.png`) });
  }
  assert.deepEqual(pageErrors, []); assert.deepEqual(observed.errors, []);
  const receiptDb = new DatabaseSync(join(root, 'xopc.db'), { readOnly: true });
  const receipts = Object.fromEntries(phases.map(phase => [phase, receiptDb.prepare("SELECT payload FROM durable_state WHERE namespace = 'command-receipts' AND scope = ?").all(conversations[phase]).map(row => JSON.parse((row as { payload: string }).payload))]));
  receiptDb.close();
  assert.equal(receipts.approve.length, 1); assert.equal(receipts.approve[0].status, 'success');
  assert.equal(receipts.deny.length, 0); assert.equal(receipts.expire.length, 0);
  checks.push('Durable execution receipts: approve=1 success, deny=0, expire=0');
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ ok: true, checks, observed, submissions, receipts, executions: Object.fromEntries(await Promise.all(phases.map(async phase => [phase, await executionCount(phase)]))) }, null, 2));
  await Promise.all(['failure.png', 'failure.html', 'failure-state.json'].map(name => rm(join(evidence, name), { force: true })));
  console.log(JSON.stringify({ ok: true, evidence, checks }));
} catch (error) {
  console.error(error);
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
    await writeFile(join(evidence, 'failure.html'), await page.content()).catch(() => {});
  }
  const db = new DatabaseSync(join(root, 'xopc.db'), { readOnly: true });
  await writeFile(join(evidence, 'failure-state.json'), JSON.stringify({ observed, pageErrors, waits: db.prepare('SELECT data_json FROM session_clarification_waits').all(), executions: Object.fromEntries(await Promise.all(phases.map(async phase => [phase, await executionCount(phase)]))) }, null, 2)); db.close();
  throw error;
} finally {
  await writeFile(join(evidence, 'gateway.log'), logs.replaceAll(token, '[test-token]'));
  await browser?.close(); child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]); if (child.exitCode === null) child.kill('SIGKILL');
  model.closeAllConnections(); await new Promise<void>(resolve => model.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
