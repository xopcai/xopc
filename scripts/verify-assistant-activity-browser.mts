import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Browser } from 'playwright-core';
const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');

import { AgentDefaultsSchema } from '../src/agent-config/schema.js';
import { seedTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { ConfigSchema } from '../src/config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../src/storage/sqlite/connection.js';

// Only model inference is controlled; Agent tools, browser, REST/WS, and SQLite are real.
const dropEnd = process.env.XOPC_ACTIVITY_DROP_END ?? 'none';
assert(['none', 'message', 'all'].includes(dropEnd));
const dropped = { message: 0, run: 0, sessions: 0 };
const finalMarkdown = 'ACTIVITY_E2E_FINAL: Both fixtures were verified. The missing file was reported clearly.\n\n| File | Result |\n| --- | --- |\n| one.txt | Verified |\n| two.txt | Verified |';
const observed = { requests: 0, turns: 0, pureReplies: 0, tools: [] as string[], errors: [] as string[] };
let releaseProgress!: () => void, releaseResult!: () => void, releasePure!: () => void;
const progressGate = new Promise<void>(resolve => { releaseProgress = resolve; });
const resultGate = new Promise<void>(resolve => { releaseResult = resolve; });
const pureGate = new Promise<void>(resolve => { releasePure = resolve; });
let fixtureRoot = '';
const model = createServer(async (req, res) => {
  try {
    let source = ''; for await (const chunk of req) source += chunk;
    const body = JSON.parse(source);
    const tools = (body.tools ?? []).map((tool: any) => tool.function ?? tool);
    observed.requests++;
    observed.tools = [...new Set([...observed.tools, ...tools.map((tool: any) => tool.name)])];
    const pure = tools.length > 0 && JSON.stringify(body.messages?.filter((message: any) => message.role === 'user').at(-1)).includes('PURE_FINAL_E2E_START');
    const scenario = !pure && tools.length > 0 && JSON.stringify(body.messages ?? []).includes('ACTIVITY_E2E_START');
    const stage = scenario ? observed.turns++ : -1;
    const envelope = { id: randomUUID(), object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'lab' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    const emit = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    const call = (paths: string[]) => {
      const direct = tools.find((tool: any) => /(^|[._])read_file$/.test(tool.name));
      const code = tools.find((tool: any) => tool.parameters?.properties?.code);
      assert(direct || code, `No file reader: ${observed.tools.join(', ')}`);
      const invocations = direct ? paths.map(path => ({ name: direct.name, args: { path } }))
        : [{ name: code.name, args: { code: `const reader = ALL_TOOLS.find(t => /(^|[._])read_file$/.test(t.name)); if (!reader) throw new Error('Missing file reader'); for (const path of ${JSON.stringify(paths)}) text(await tools[reader.name]({path}));` } }];
      emit({ tool_calls: invocations.map((invocation, index) => ({ index, id: 'call_' + randomUUID().replaceAll('-', ''), type: 'function', function: { name: invocation.name, arguments: JSON.stringify(invocation.args) } })) });
    };
    if (pure) {
      observed.pureReplies++;
      emit({ role: 'assistant', content: 'PURE_FINAL_E2E_RESULT\n\n| File | Result |\n| --- | --- |\n| report.md | Ready |' });
      await pureGate;
      emit({}, 'stop');
    } else if (stage === 0) {
      emit({ role: 'assistant', reasoning_content: 'PRIVATE_ACTIVITY_REASONING' });
      emit({ content: 'I will inspect the two activity fixtures.' });
      await progressGate;
      call([join(fixtureRoot, 'one.txt'), join(fixtureRoot, 'two.txt')]);
      emit({}, 'tool_calls');
    } else if (stage === 1) {
      emit({ role: 'assistant', content: 'The fixtures are read. I will check the missing file before reporting.' });
      call([join(fixtureRoot, 'missing.txt')]);
      emit({}, 'tool_calls');
    } else if (stage >= 2) {
      emit({ role: 'assistant', content: 'ACTIVITY_E2E_FINAL: Both fixtures were verified. ' });
      await new Promise(resolve => setTimeout(resolve, 150));
      emit({ content: finalMarkdown.slice('ACTIVITY_E2E_FINAL: Both fixtures were verified. '.length) });
      await resultGate;
      emit({}, 'stop');
    } else {
      emit({ role: 'assistant', content: 'Activity verification' }); emit({}, 'stop');
    }
    res.end('data: [DONE]\n\n');
  } catch (error) { observed.errors.push(String(error)); if (!res.headersSent) res.writeHead(500); res.end(); }
});
model.listen(0, '127.0.0.1'); await once(model, 'listening');
const modelAddress = model.address(); assert(modelAddress && typeof modelAddress !== 'string');
const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
const address = listener.address(); assert(address && typeof address !== 'string');
const port = address.port; await new Promise<void>(r => listener.close(() => r()));
const root = await mkdtemp(join(tmpdir(), 'xopc-activity-browser-'));
const evidence = resolve(process.env.XOPC_ACTIVITY_EVIDENCE ?? `/tmp/xopc-assistant-activity-browser${dropEnd === 'none' ? '' : '-' + dropEnd}`);
await mkdir(evidence, { recursive: true });
await rm(join(evidence, 'result.json'), { force: true });
fixtureRoot = root;
await writeFile(join(root, 'one.txt'), 'ACTIVITY_FIXTURE_ONE');
await writeFile(join(root, 'two.txt'), 'ACTIVITY_FIXTURE_TWO');
await writeFile(join(evidence, 'activity-events.log'), '');
const token = randomUUID(), base = `http://127.0.0.1:${port}`;
Object.assign(process.env, { XOPC_STATE_DIR: root, XOPC_CONFIG_PATH: join(root, 'xopc.json'), XOPC_WORKSPACE: root,
  PI_CODING_AGENT_DIR: join(root, 'pi'), XOPC_LOG_LEVEL: 'warn', XOPC_LOG_CONSOLE: 'false' });
await writeFile(join(root, 'xopc.json'), JSON.stringify(ConfigSchema.parse({ gateway: { port, auth: { mode: 'token', token } } })));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { 'activity-lab': { baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`, api: 'openai-completions', apiKey: 'synthetic-test-key', models: [{ id: 'lab', name: 'Activity controlled model', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 2048 }] } } }));
const route = { primary: 'activity-lab/lab', fallbacks: [] };
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
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.addInitScript(() => localStorage.setItem('xopc.language', 'en'));
  const auth = await context.request.post(base + '/api/browser-session', { headers: { Authorization: `Bearer ${token}`, Origin: base, 'Sec-Fetch-Site': 'same-origin' } }); assert(auth.ok(), `${auth.status()}: ${await auth.text()}`);
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  const errors: string[] = [];
  if (dropEnd !== 'none') await page.routeWebSocket('**/api/realtime/v1/ws*', socket => {
    const server = socket.connectToServer();
    server.onMessage(message => {
      const frame = JSON.parse(String(message));
      const event = frame.kind === 'realtime.event' ? frame.payload?.event : undefined;
      if (event === 'assistant_message_end') { dropped.message++; return; }
      if (dropEnd === 'all' && event === 'run_end') { dropped.run++; return; }
      if (dropEnd === 'all' && event === 'run.completed') { dropped.sessions++; return; }
      socket.send(message);
    });
  });
  page.on('websocket', socket => socket.on('framereceived', frame => { const text = String(frame.payload); if (/tool_start|tool_end|assistant_message_end|run_end/.test(text)) void writeFile(join(evidence, 'activity-events.log'), text + '\n', { flag: 'a' }); }));
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(base + '/#/chat');
  let composerReadySince = 0;
  for (let i = 0; i < 80; i++) {
    const later = page.getByRole('button', { name: 'Maybe later, keep using my current model', exact: true });
    const skip = page.getByRole('button', { name: 'Skip for now', exact: true });
    if (await later.isVisible()) await later.click({ timeout: 1000 }).catch(() => {});
    if (await skip.isVisible()) await skip.click({ timeout: 1000 }).catch(() => {});
    const ready = await page.locator('[contenteditable="true"]').first().isVisible()
      && !await page.locator('.xopc-onboarding-dialog').isVisible();
    if (!ready) composerReadySince = 0;
    else if (!composerReadySince) composerReadySince = Date.now();
    else if (Date.now() - composerReadySince >= 750) break;
    await page.waitForTimeout(250);
  }
  const composer = page.locator('[contenteditable="true"]').first();
  await composer.click();
  await page.keyboard.insertText('ACTIVITY_E2E_START: Read the two fixtures, check the missing file, and report the final result.');
  await composer.press('Enter');
  const workLog = page.locator('[data-assistant-work-log]').last();
  const disclosure = workLog.locator(':scope > button[aria-expanded]');
  await page.getByText('I will inspect the two activity fixtures.', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-chat-find-text]').filter({ hasText: 'I will inspect' }).count(), 1);
  assert.equal(await workLog.getByText('I will inspect the two activity fixtures.', { exact: true }).count(), 0);
  assert.equal(await page.getByText('PRIVATE_ACTIVITY_REASONING', { exact: true }).isVisible(), false);
  await page.screenshot({ path: join(evidence, 'running-progress.png') });
  // Unclassified prose starts in the body; later tool activity confirms it as narration.
  releaseProgress();
  const finalBody = page.locator('[data-chat-find-text]').filter({ hasText: 'ACTIVITY_E2E_FINAL' });
  await finalBody.getByRole('table').waitFor();
  const streamingTable = await finalBody.getByRole('table').elementHandle();
  assert.equal(await workLog.getByRole('table').count(), 0);
  assert.equal(await workLog.getByText('ACTIVITY_E2E_FINAL', { exact: false }).count(), 0);
  await page.screenshot({ path: join(evidence, 'streaming-final.png') });
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
  await disclosure.click();
  const earlier = workLog.getByRole('button', { name: 'View earlier steps', exact: true });
  if (await earlier.isVisible()) await earlier.click();
  await workLog.locator('[data-activity-group]').first().waitFor();
  assert(await workLog.locator('[data-activity-group] summary').first().textContent());
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(evidence, 'running-tools.png') });
  // Finishing resets the live expansion choice; reopening completed details remains possible.
  releaseResult();
  await workLog.locator('[data-status-phase]').waitFor({ state: 'detached' });
  await page.locator('[data-chat-find-text]').filter({ hasText: 'ACTIVITY_E2E_FINAL' }).waitFor();
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('[data-chat-find-text]').filter({ hasText: 'I will inspect' }).count(), 0);
  await page.waitForTimeout(300);
  assert.equal(await workLog.locator('[data-assistant-activity-flow]').isVisible(), false);
  await page.screenshot({ path: join(evidence, 'completed-result.png') });
  await page.locator('article').filter({ hasText: 'ACTIVITY_E2E_FINAL' }).last().hover();
  await page.getByRole('button', { name: 'Copy plain text', exact: true }).last().click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert(copied.startsWith('ACTIVITY_E2E_FINAL: Both fixtures were verified. The missing file was reported clearly.'));
  assert(copied.includes('Verified'));
  assert(!copied.includes('I will inspect'));
  if (dropEnd !== 'all') assert(await finalBody.getByRole('table').evaluate((table, original) => table === original, streamingTable));
  await disclosure.click();
  await workLog.getByText('I will inspect the two activity fixtures.', { exact: true }).waitFor();
  await workLog.locator('[data-activity-group] summary').first().click();
  assert(await workLog.locator('[data-activity-status]').count() >= 3);
  await page.screenshot({ path: join(evidence, 'expanded-process.png') });
  const url = page.url();
  await page.reload();
  await page.locator('[data-chat-find-text]').filter({ hasText: 'ACTIVITY_E2E_FINAL' }).waitFor();
  assert.equal(page.url(), url);
  const history = page.locator('[data-assistant-work-log]').last();
  assert.equal(await history.locator(':scope > button[aria-expanded]').getAttribute('aria-expanded'), 'false');
  await history.locator(':scope > button[aria-expanded]').click();
  assert(await history.locator('[data-activity-group]').count() >= 1);
  await history.getByText('The fixtures are read. I will check the missing file before reporting.', { exact: true }).waitFor();
  await page.screenshot({ path: join(evidence, 'history-reloaded.png') });
  await page.setViewportSize({ width: 375, height: 812 });
  const closeMenu = page.getByRole('button', { name: 'Close menu', exact: true }).first();
  if (await closeMenu.isVisible()) await closeMenu.click();
  await page.waitForTimeout(250);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(evidence, 'narrow-result.png') });
  await page.setViewportSize({ width: 1365, height: 1000 });
  for (const [level, label] of [
    ['off', 'Concise · hide normal activity'],
    ['stream', 'Live · expand while working'],
    ['on', 'Lightweight activity · collapses on completion'],
  ] as const) {
    await page.goto(base + '/#/settings/appearance');
    const section = page.getByText('AI activity detail', { exact: true }).locator('..');
    await section.getByRole('button').click();
    const saved = page.waitForResponse(response => response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === '/api/config');
    await page.getByRole('button', { name: label, exact: true }).last().click();
    assert((await saved).ok());
    const config = await context.request.get(base + '/api/config');
    assert.equal((await config.json()).payload.config.gateway.webchat.activityDetailDefault, level);
    await page.goto(url);
    await page.locator('[data-chat-find-text]').filter({ hasText: 'ACTIVITY_E2E_FINAL' }).waitFor();
    if (level === 'off') {
      await page.waitForFunction(() => !document.querySelector('[data-assistant-work-log] button[aria-expanded]'));
      assert.equal(await page.locator('[data-assistant-work-log] button[aria-expanded]').count(), 0);
      assert.equal(await page.getByText('I will inspect the two activity fixtures.', { exact: true }).isVisible(), false);
    } else {
      const toggle = page.locator('[data-assistant-work-log] > button[aria-expanded]').last();
      await toggle.waitFor();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.click();
      await page.getByText('I will inspect the two activity fixtures.', { exact: true }).waitFor();
    }
    await page.screenshot({ path: join(evidence, `mode-${level}.png`) });
  }
  await page.goto(base + '/#/settings/appearance');
  assert.equal(await page.getByLabel('Show tool debugging data', { exact: false }).count(), 0);
  await page.getByRole('checkbox', { name: 'Toggle advanced settings navigation' }).check();
  await page.getByLabel('Show tool debugging data', { exact: false }).check();
  await page.goto(url);
  const debugToggle = page.locator('[data-assistant-work-log] > button[aria-expanded]').last();
  await debugToggle.click();
  assert.equal(await page.locator('[data-activity-group]').count(), 0);
  assert(await page.getByText('Raw thinking data (developer)', { exact: true }).count() > 0);
  await page.getByText('Raw thinking data (developer)', { exact: true }).first().click();
  await page.getByText('PRIVATE_ACTIVITY_REASONING', { exact: true }).waitFor();
  await page.screenshot({ path: join(evidence, 'developer-details.png') });
  await page.goto(base + '/#/settings/appearance');
  await page.getByLabel('Show tool debugging data', { exact: false }).uncheck();
  await page.getByRole('checkbox', { name: 'Toggle advanced settings navigation' }).uncheck();
  assert.equal(await page.getByLabel('Show tool debugging data', { exact: false }).count(), 0);
  await page.screenshot({ path: join(evidence, 'settings-simple.png') });
  await page.goto(url);
  await composer.click();
  await page.keyboard.insertText('PURE_FINAL_E2E_START: Reply directly with the final table. Do not call tools.');
  await composer.press('Enter');
  const pureArticle = page.locator('article').filter({ hasText: 'PURE_FINAL_E2E_RESULT' }).last();
  await pureArticle.getByRole('table').waitFor();
  assert.equal(await pureArticle.locator('[data-assistant-work-log]').count(), 0);
  const pureTable = await pureArticle.getByRole('table').elementHandle();
  await page.screenshot({ path: join(evidence, 'pure-streaming-final.png') });
  releasePure();
  await pureArticle.locator('[data-assistant-message-actions]').waitFor();
  assert.equal(await pureArticle.locator('[data-assistant-work-log]').count(), 0);
  if (dropEnd !== 'all') assert(await pureArticle.getByRole('table').evaluate((table, original) => table === original, pureTable));
  await page.screenshot({ path: join(evidence, 'pure-completed-final.png') });
  assert.equal(observed.pureReplies, 1);
  assert.deepEqual(errors, []); assert.deepEqual(observed.errors, []);
  assert.equal(observed.turns, 3);
  if (dropEnd !== 'none') assert(dropped.message >= 3);
  if (dropEnd === 'all') { assert(dropped.run >= 1); assert(dropped.sessions >= 1); }
  await Promise.all(['failure.png', 'failure.html', 'model.json'].map(name => rm(join(evidence, name), { force: true })));
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ ok: true, checks: ['production WebUI and authenticated Gateway', 'actual Agent file tools', 'live unclassified text outside process', 'streaming final Markdown table outside process', 'pure text streaming table without activity container', 'private thinking hidden', 'consecutive tool aggregation', 'completion auto-collapse', 'final result isolated', 'completed process can reopen', 'SQLite history reload', 'narrow viewport', 'existing off/on/stream settings via UI', 'developer details toggle', 'simple/advanced settings preserved', 'clipboard contains only final result'], observed, dropEnd, dropped }, null, 2));
  console.log(JSON.stringify({ ok: true, evidence }));
} catch (error) {
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
  releaseProgress(); releaseResult(); releasePure();
  model.closeAllConnections(); await new Promise<void>(r => model.close(() => r()));
  await rm(root, { recursive: true, force: true });
}
process.exit(0);
