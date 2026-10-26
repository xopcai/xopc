import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Browser } from 'playwright-core';
const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');

import { AgentDefaultsSchema } from '../src/agent-config/schema.js';
import { seedTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { ConfigSchema } from '../src/config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../src/storage/sqlite/connection.js';

// Only inference is deterministic: browser, Agent tools, HTTP/WS and SQLite are real.
const fixture = JSON.parse(await readFile(new URL('../packages/gateway-contract/fixtures/clarification-v2.json', import.meta.url), 'utf8'));
const observed = { requests: 0, toolCalls: 0, tools: [] as string[], errors: [] as string[] };
const model = createServer(async (req, res) => {
  try {
    let source = ''; for await (const chunk of req) source += chunk;
    const body = JSON.parse(source), text = JSON.stringify(body.messages ?? []);
    const tools = (body.tools ?? []).map((t: any) => t.function ?? t);
    observed.requests++;
    observed.tools = [...new Set([...observed.tools, ...tools.map((t: any) => t.name)])];
    let toolCalls: unknown[] | undefined;
    let content = 'Clarification E2E';
    if (tools.length && text.includes('Engineering notes')) content = 'CLARIFY_E2E_COMPLETE: Blog / Weekly / Engineering notes';
    else if (tools.length && text.includes('CLARIFY_E2E_START')) {
      const direct = tools.find((t: any) => /(^|[._])clarify$/.test(t.name));
      const code = tools.find((t: any) => t.parameters?.properties?.code);
      const search = tools.find((t: any) => t.name === 'tool_search');
      assert(direct || code || search, `No clarification tool: ${observed.tools.join(', ')}`);
      const args = direct ? fixture : !code ? { query: 'clarify ask user questions', limit: 1 } : { code: `const tool = ALL_TOOLS.find(t => /(^|[._])clarify$/.test(t.name)); if (!tool) throw new Error('Missing clarify'); text(await tools[tool.name](${JSON.stringify(fixture)}));` };
      toolCalls = [{ index: 0, id: 'call_' + randomUUID().replaceAll('-', ''), type: 'function', function: { name: direct?.name ?? code?.name ?? search.name, arguments: JSON.stringify(args) } }];
      if (direct || code) observed.toolCalls++;
    }
    const envelope = { id: randomUUID(), object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'lab', choices: [{ index: 0, delta: toolCalls ? { role: 'assistant', tool_calls: toolCalls } : { role: 'assistant', content }, finish_reason: null }] };
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    res.write(`data: ${JSON.stringify(envelope)}\n\n`);
    res.write(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta: {}, finish_reason: toolCalls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  } catch (error) { observed.errors.push(String(error)); res.writeHead(500).end(); }
});
model.listen(0, '127.0.0.1'); await once(model, 'listening');
const modelAddress = model.address(); assert(modelAddress && typeof modelAddress !== 'string');
const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
const address = listener.address(); assert(address && typeof address !== 'string');
const port = address.port; await new Promise<void>(r => listener.close(() => r()));
const root = await mkdtemp(join(tmpdir(), 'xopc-clarify-browser-'));
const evidence = resolve(process.env.XOPC_CLARIFY_EVIDENCE ?? '/tmp/xopc-clarification-browser');
await mkdir(evidence, { recursive: true });
await writeFile(join(evidence, 'clarification-events.log'), '');
const token = randomUUID(), base = `http://127.0.0.1:${port}`;
Object.assign(process.env, { XOPC_STATE_DIR: root, XOPC_CONFIG_PATH: join(root, 'xopc.json'), XOPC_WORKSPACE: root,
  PI_CODING_AGENT_DIR: join(root, 'pi'), XOPC_LOG_LEVEL: 'warn', XOPC_LOG_CONSOLE: 'false' });
await writeFile(join(root, 'xopc.json'), JSON.stringify(ConfigSchema.parse({ gateway: { port, auth: { mode: 'token', token } } })));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { 'clarify-lab': { baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`, api: 'openai-completions', apiKey: 'synthetic-test-key', models: [{ id: 'lab', name: 'Clarification controlled model', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 2048 }] } } }));
const route = { primary: 'clarify-lab/lab', fallbacks: [] };
openXopcDatabase();
seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: route, background: route,
  intents: Object.fromEntries(['fast', 'reasoning', 'coding', 'review', 'vision', 'understanding'].map(k => [k, route])) }, runtime: { maxTurns: 8, timeoutMs: 90000 } }),
  agents: [{ id: 'main', enabled: true, workspace: root, profile: { name: 'Main' } }] });
closeXopcDatabase();
const child = spawn(process.execPath, ['dist/src/cli/bin.js', 'gateway', '--port', String(port), '--no-hot-reload'], { cwd: resolve('.'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '', browser: Browser | undefined;
child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
try {
  let ready = false;
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) throw new Error(`Gateway exited: ${logs.slice(-3000)}`);
    try { if ((await fetch(base + '/health', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* Gateway is starting. */ }
    await new Promise(r => setTimeout(r, 200));
  }
  assert(ready, logs.slice(-3000));
  browser = await chromium.launch({ headless: true, channel: process.env.XOPC_BROWSER_CHANNEL || 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, locale: 'en-US' });
  await context.addInitScript(() => localStorage.setItem('xopc.language', 'en'));
  const auth = await context.request.post(base + '/api/browser-session', { headers: { Authorization: `Bearer ${token}`, Origin: base, 'Sec-Fetch-Site': 'same-origin' } }); assert(auth.ok(), `${auth.status()}: ${await auth.text()}`);
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  const errors: string[] = [], submissions: unknown[] = [];
  page.on('websocket', socket => socket.on('framereceived', frame => { const text = String(frame.payload); if (/clarif|suspended/.test(text)) void writeFile(join(evidence, 'clarification-events.log'), text + '\n', { flag: 'a' }); }));
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' && /\/clarifications\/.+\/responses$/.test(new URL(request.url()).pathname)) submissions.push(request.postDataJSON()); });
  await page.goto(base + '/#/chat');
  for (let i = 0; i < 40; i++) {
    const later = page.getByRole('button', { name: 'Maybe later, keep using my current model', exact: true });
    const skip = page.getByRole('button', { name: 'Skip for now', exact: true });
    if (await later.isVisible()) await later.click({ timeout: 1000 }).catch(() => {});
    if (await skip.isVisible()) await skip.click({ timeout: 1000 }).catch(() => {});
    if (await page.locator('[contenteditable="true"]').first().isVisible()) break;
    await page.waitForTimeout(250);
  }
  const composer = page.locator('[contenteditable="true"]').first();
  await composer.click();
  await page.keyboard.insertText('CLARIFY_E2E_START: help me prepare a publishing plan. Ask the three independent questions together.');
  await composer.press('Enter');
  await page.getByText('0/3 answered', { exact: true }).waitFor();
  assert.equal(await page.locator('[aria-pressed="true"]').count(), 0);
  await page.getByRole('button', { name: /Blog.*Long-form content/ }).click();
  await page.getByLabel('Additional information', { exact: false }).fill('Include diagrams');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Weekly', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.locator('section[data-clarification-id] textarea').fill('Engineering notes');
  await page.waitForTimeout(450);
  const waitingId = await page.locator('section[data-clarification-id]').getAttribute('data-clarification-id');
  await page.screenshot({ path: join(evidence, 'desktop-before-submit.png') });
  await page.reload();
  await page.getByText('3/3 answered', { exact: true }).waitFor();
  assert.equal(await page.locator('section[data-clarification-id] textarea').inputValue(), 'Engineering notes');
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Weekly', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  assert.equal(await page.getByLabel('Additional information', { exact: false }).inputValue(), 'Include diagrams');
  const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true }).first();
  if (await collapse.isVisible()) await collapse.click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(250);
  const closeMenu = page.getByRole('button', { name: 'Close menu', exact: true }).first();
  if (await closeMenu.isVisible()) await closeMenu.click();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const panel = await page.locator('section[data-clarification-id]').boundingBox();
  assert(panel && panel.x >= 0 && panel.x + panel.width <= 375);
  await page.screenshot({ path: join(evidence, 'narrow-question.png') });
  await page.setViewportSize({ width: 1365, height: 1000 });
  await page.getByRole('button', { name: 'Next', exact: true }).click(); await page.getByRole('button', { name: 'Next', exact: true }).click();
  const accepted = page.waitForResponse(r => /\/clarifications\/.+\/responses$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Submit and continue', exact: true }).dblclick();
  assert.equal((await accepted).status(), 202);
  await page.getByText('CLARIFY_E2E_COMPLETE: Blog / Weekly / Engineering notes', { exact: false }).waitFor({ timeout: 60000 });
  assert(submissions.length >= 1);
  assert(submissions.every(s => JSON.stringify(s) === JSON.stringify(submissions[0])));
  assert.equal(observed.toolCalls, 1, 'Exactly one clarification tool call');
  const submitted = submissions[0] as { schemaVersion: number; answers: unknown[] };
  assert.equal(submitted.schemaVersion, 2); assert.equal(submitted.answers.length, 3);
  const replay = await context.request.post(`${base}/api/clarifications/${waitingId}/responses`, { data: submissions[0], headers: { Origin: base, 'Sec-Fetch-Site': 'same-origin' } });
  assert(replay.ok(), `${replay.status()}: ${await replay.text()}`); assert.equal((await replay.json()).payload.idempotent, true);
  await page.reload(); await page.getByText('CLARIFY_E2E_COMPLETE: Blog / Weekly / Engineering notes', { exact: false }).waitFor();
  await page.screenshot({ path: join(evidence, 'completed-history.png') });
  assert.deepEqual(errors, []); assert.deepEqual(observed.errors, []);
  await Promise.all(['failure.png', 'failure.html', 'database.json', 'model.json'].map(name => rm(join(evidence, name), { force: true })));
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ ok: true, checks: ['production WebUI and Gateway', 'actual Agent clarify tool', 'three questions', 'no recommendation auto-submit', 'draft reload', 'narrow viewport', 'single resume', 'idempotent replay', 'history reload'], observed }, null, 2));
  console.log(JSON.stringify({ ok: true, evidence }));
} catch (error) {
  const diagnostic = new DatabaseSync(join(root, 'xopc.db'), { readOnly: true });
  await writeFile(join(evidence, 'database.json'), JSON.stringify({ waits: diagnostic.prepare('SELECT data_json FROM session_clarification_waits').all(), inputs: diagnostic.prepare('SELECT kind,status,context_snapshots_json FROM session_inputs').all() }, null, 2)).catch(() => {}); diagnostic.close();
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
    await writeFile(join(evidence, 'failure.html'), await page.content()).catch(() => {});
  }
  await writeFile(join(evidence, 'model.json'), JSON.stringify(observed, null, 2));
  throw error;
} finally {
  await writeFile(join(evidence, 'gateway.log'), logs.replaceAll(token, '[test-token]'));
  await browser?.close(); child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(r => setTimeout(r, 5000))]); if (child.exitCode === null) child.kill('SIGKILL');
  model.closeAllConnections(); await new Promise<void>(r => model.close(() => r()));
  await rm(root, { recursive: true, force: true });
}
process.exit(0);
