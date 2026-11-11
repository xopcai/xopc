import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
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
const forcePolling = process.argv.includes('--polling');
const benchmarkAssociation = process.argv.includes('--benchmark-association');
const benchmarkWorkspace = process.argv.includes('--benchmark-workspace');
const verifyPersonalIdle = process.argv.includes('--personal-idle');
assert(['none', 'message', 'all'].includes(dropEnd));
const dropped = { message: 0, run: 0, sessions: 0 };
const finalMarkdown = 'ACTIVITY_E2E_FINAL: Both fixtures were verified. The missing file was reported clearly.\n\n| File | Result |\n| --- | --- |\n| one.txt | Verified |\n| two.txt | Verified |';
const observed = { requests: 0, turns: 0, pureReplies: 0, tools: [] as string[], errors: [] as string[] };
let releaseProgress!: () => void, releaseResult!: () => void, releasePure!: () => void;
let releasePersonalHistory!: () => void;
let markPersonalHistoryRequested!: () => void;
const progressGate = new Promise<void>(resolve => { releaseProgress = resolve; });
const resultGate = new Promise<void>(resolve => { releaseResult = resolve; });
const pureGate = new Promise<void>(resolve => { releasePure = resolve; });
const personalHistoryGate = new Promise<void>(resolve => { releasePersonalHistory = resolve; });
const personalHistoryRequested = new Promise<void>(resolve => { markPersonalHistoryRequested = resolve; });
let fixtureRoot = '';
const model = createServer(async (req, res) => {
  try {
    let source = ''; for await (const chunk of req) source += chunk;
    const body = JSON.parse(source);
    const tools = (body.tools ?? []).map((tool: any) => tool.function ?? tool);
    observed.requests++;
    observed.tools = [...new Set([...observed.tools, ...tools.map((tool: any) => tool.name)])];
    const lastUser = JSON.stringify(body.messages?.filter((message: any) => message.role === 'user').at(-1));
    const fast = tools.length ? lastUser?.match(/FAST_FINAL_E2E_START_(REALTIME|RECEIPT)/)?.[1] : undefined;
    const bench = tools.length ? lastUser?.match(/ASSOCIATION_BENCH_START_(\d+)/)?.[1] : undefined;
    const personalIdle = lastUser?.includes('PERSONAL_IDLE_E2E_START');
    const personalHistory = lastUser?.includes('PERSONAL_HISTORY_E2E_START');
    const pure = tools.length > 0 && lastUser?.includes('PURE_FINAL_E2E_START');
    const scenario = !pure && !fast && !bench && !personalIdle && tools.length > 0 && JSON.stringify(body.messages ?? []).includes('ACTIVITY_E2E_START');
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
    if (personalHistory) {
      markPersonalHistoryRequested();
      await personalHistoryGate;
      emit({ role: 'assistant', content: 'PERSONAL_HISTORY_E2E_RESULT. The follow-up is ready.' });
      emit({}, 'stop');
    } else if (personalIdle) {
      emit({ role: 'assistant', content: 'PERSONAL_IDLE_E2E_RESULT. The idle reply is ready.' });
      emit({}, 'stop');
    } else if (bench) {
      emit({ role: 'assistant', content: `ASSOCIATION_BENCH_RESULT_${bench}.` });
      // Keep the same reply available live to both subscription strategies.
      await new Promise(resolve => setTimeout(resolve, benchmarkWorkspace ? 120 : 650));
      emit({}, 'stop');
    } else if (fast) {
      emit({ role: 'assistant', content: `FAST_FINAL_E2E_RESULT_${fast}.` });
      emit({}, 'stop');
    } else if (pure) {
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
fixtureRoot = benchmarkWorkspace ? join(root, 'workspace') : root;
await mkdir(fixtureRoot, { recursive: true });
await writeFile(join(fixtureRoot, 'one.txt'), 'ACTIVITY_FIXTURE_ONE');
await writeFile(join(fixtureRoot, 'two.txt'), 'ACTIVITY_FIXTURE_TWO');
if (benchmarkWorkspace) {
  execFileSync('git', ['init', '-q'], { cwd: fixtureRoot });
  execFileSync('git', ['add', '--', 'one.txt', 'two.txt'], { cwd: fixtureRoot });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@xopc.local', 'commit', '-qm', 'fixture'], { cwd: fixtureRoot });
  for (let index = 0; index < 32; index++) await writeFile(join(fixtureRoot, `untracked-${index}.txt`), 'Workspace fixture.\n'.repeat(32));
}
await writeFile(join(evidence, 'activity-events.log'), '');
const token = randomUUID(), base = `http://127.0.0.1:${port}`;
Object.assign(process.env, { XOPC_STATE_DIR: root, XOPC_CONFIG_PATH: join(root, 'xopc.json'), XOPC_WORKSPACE: fixtureRoot,
  PI_CODING_AGENT_DIR: join(root, 'pi'), XOPC_LOG_LEVEL: 'info', XOPC_LOG_CONSOLE: 'true', XOPC_PRETTY_LOGS: 'false' });
await writeFile(join(root, 'xopc.json'), JSON.stringify(ConfigSchema.parse({ gateway: { port, auth: { mode: 'token', token } } })));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { 'activity-lab': { baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`, api: 'openai-completions', apiKey: 'synthetic-test-key', models: [{ id: 'lab', name: 'Activity controlled model', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 2048 }] } } }));
const route = { primary: 'activity-lab/lab', fallbacks: [] };
openXopcDatabase();
seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: route, background: route,
  intents: Object.fromEntries(['fast', 'reasoning', 'coding', 'review', 'vision', 'understanding'].map(k => [k, route])) }, runtime: { maxTurns: 8, timeoutMs: 90000 } }),
  agents: [{ id: 'main', enabled: true, workspace: fixtureRoot, profile: { name: 'Main' } }] });
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
  await context.addInitScript(() => {
    localStorage.setItem('xopc.language', 'en');
    localStorage.setItem('xopc.performance', '1');
  });
  const auth = await context.request.post(base + '/api/browser-session', { headers: { Authorization: `Bearer ${token}`, Origin: base, 'Sec-Fetch-Site': 'same-origin' } }); assert(auth.ok(), `${auth.status()}: ${await auth.text()}`);
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  const errors: string[] = [];
  let fastPath: 'REALTIME' | 'RECEIPT' | undefined;
  let associationMode: 'realtime' | 'poll' | undefined;
  await page.routeWebSocket('**/api/realtime/v1/ws*', socket => {
    const server = socket.connectToServer();
    server.onMessage(message => {
      const frame = JSON.parse(String(message));
      const event = frame.kind === 'realtime.event' ? frame.payload?.event : undefined;
      if (fastPath && event === 'run.started') return;
      if (fastPath === 'RECEIPT' && event === 'run.completed') return;
      if ((associationMode ? associationMode === 'poll' : forcePolling) && !fastPath && (event === 'run.started' || event === 'run.completed')) {
        delete frame.payload.data?.inputId;
        delete frame.payload.data?.clientMessageId;
        socket.send(JSON.stringify(frame));
        return;
      }
      if (dropEnd !== 'none' && event === 'assistant_message_end') { dropped.message++; return; }
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
  const workLog = page.locator('[data-assistant-work-log]').nth(1);
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
  // Public narration remains in place; completed activity can be inspected separately.
  await disclosure.click();
  await disclosure.evaluate(element => (element as HTMLButtonElement).blur());
  releaseResult();
  await workLog.locator('[data-status-phase]').waitFor({ state: 'detached' });
  const processToggle = page.locator('[data-assistant-process-toggle]');
  await processToggle.waitFor();
  assert.equal(await processToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.getByText('I will inspect the two activity fixtures.', { exact: true }).isVisible(), false);
  await page.locator('[data-chat-find-text]').filter({ hasText: 'ACTIVITY_E2E_FINAL' }).waitFor();
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('[data-chat-find-text]').filter({ hasText: 'I will inspect' }).count(), 1);
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
  await processToggle.click();
  await disclosure.click();
  await page.getByText('I will inspect the two activity fixtures.', { exact: true }).waitFor();
  await workLog.locator('[data-activity-group] summary').first().click();
  assert(await workLog.locator('[data-activity-status]').count() >= 2);
  await page.screenshot({ path: join(evidence, 'expanded-process.png') });
  const url = page.url();
  await page.reload();
  await page.locator('[data-chat-find-text]').filter({ hasText: 'ACTIVITY_E2E_FINAL' }).waitFor();
  assert.equal(page.url(), url);
  const history = page.locator('[data-assistant-work-log]').nth(1);
  assert.equal(await processToggle.getAttribute('aria-expanded'), 'false');
  await processToggle.click();
  assert.equal(await history.locator(':scope > button[aria-expanded]').getAttribute('aria-expanded'), 'false');
  await history.locator(':scope > button[aria-expanded]').click();
  assert(await history.locator('[data-activity-group]').count() >= 1);
  await page.getByText('The fixtures are read. I will check the missing file before reporting.', { exact: true }).waitFor();
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
    ['on', 'Lightweight · collapse activity details'],
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
      // Failed tools remain inspectable even when routine activity is hidden.
      await processToggle.waitFor({ state: 'hidden' });
      await page.getByText('I will inspect the two activity fixtures.', { exact: true }).waitFor({ state: 'hidden' });
      assert.equal(await page.locator('[data-assistant-thinking]').count(), 0);
      assert.equal(await page.getByText('I will inspect the two activity fixtures.', { exact: true }).isVisible(), false);
    } else {
      await processToggle.waitFor();
      assert.equal(await processToggle.getAttribute('aria-expanded'), 'false');
      await processToggle.click();
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
  await processToggle.click();
  const debugToggle = page.locator('[data-assistant-work-log] > button[aria-expanded]').first();
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
  const previousRunIds = await page.evaluate(() => ((window as any).__xopcResponseLatencyMetrics() as { runId: string }[])
    .map(sample => sample.runId));
  await page.keyboard.insertText('PURE_FINAL_E2E_START: Reply directly with the final table. Do not call tools.');
  await composer.press('Enter');
  const pureArticle = page.locator('article').filter({ hasText: 'PURE_FINAL_E2E_RESULT' }).last();
  await pureArticle.getByRole('table').waitFor();
  assert.equal(await pureArticle.locator('[data-assistant-work-log]').count(), 0);
  const latencyHandle = await page.waitForFunction(previous =>
    ((window as any).__xopcResponseLatencyMetrics() as Array<{ runId: string; firstVisibleMs?: number }>)
      .find(sample => !previous.includes(sample.runId) && Number.isFinite(sample.firstVisibleMs)), previousRunIds);
  const clientLatency = await latencyHandle.jsonValue() as { runId: string } & Record<string, number>;
  for (const phase of ['senderStartedMs', 'endpointClaimMs', 'environmentCaptureMs', 'postStartedMs', 'postResponseMs',
    'gatewayInputReceiptMs', 'inputAcceptedMs', 'runBoundMs', 'firstTextMs', 'firstVisibleMs', 'firstRenderLagMs']) {
    assert(Number.isFinite(clientLatency[phase]) && clientLatency[phase] >= 0, `Missing client latency phase ${phase}`);
  }
  assert.equal(clientLatency.runAssociation, forcePolling ? 'poll' : 'realtime');
  assert.equal(clientLatency.firstTextSource, 'realtime');
  assert(clientLatency.postStartedMs <= clientLatency.postResponseMs);
  assert(clientLatency.inputAcceptedMs <= clientLatency.runBoundMs);
  assert(clientLatency.runBoundMs <= clientLatency.firstTextMs && clientLatency.firstTextMs <= clientLatency.firstVisibleMs);
  const findPhase = (phase: string) => logs.split('\n').flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }).find(entry => entry.runId === clientLatency.runId && entry.phase === phase);
  const modelRequest = findPhase('first_model_request');
  const modelDelta = findPhase('first_model_delta');
  const modelText = findPhase('first_model_text');
  const gatewayText = findPhase('first_response_text');
  assert(Number.isFinite(modelRequest?.gatewayRunToFirstModelRequestMs));
  assert(Number.isFinite(modelDelta?.modelFirstDeltaMs));
  assert(Number.isFinite(modelText?.firstRequestToTextMs));
  assert(Number.isFinite(gatewayText?.queueMs));
  for (const phase of ['userContextMs', 'mediaHydrationMs', 'directPreparationMs', 'memoryReadyMs', 'sessionPreparationMs',
    'workspaceInstructionsMs', 'runnerAcquireMs', 'transcriptLoadMs', 'workspaceVerificationMs', 'modelPayloadPreparationMs']) {
    assert(Number.isFinite(modelRequest.preparationTimings?.[phase]) && modelRequest.preparationTimings[phase] >= 0,
      `Missing model preparation phase ${phase}`);
  }
  const responseLatency = {
    client: clientLatency,
    gateway: { queueMs: gatewayText.queueMs, runToModelRequestMs: modelRequest.gatewayRunToFirstModelRequestMs,
      modelFirstDeltaMs: modelDelta.modelFirstDeltaMs, firstModelRequestToTextMs: modelText.firstRequestToTextMs,
      runToTextMs: gatewayText.latencyMs, preparationTimings: modelRequest.preparationTimings, runnerReused: modelRequest.runnerReused },
  };
  const pureTable = await pureArticle.getByRole('table').elementHandle();
  await page.screenshot({ path: join(evidence, 'pure-streaming-final.png') });
  releasePure();
  await pureArticle.locator('[data-assistant-message-actions]').waitFor();
  assert.equal(await pureArticle.locator('[data-assistant-work-log]').count(), 0);
  if (dropEnd !== 'all') assert(await pureArticle.getByRole('table').evaluate((table, original) => table === original, pureTable));
  await page.screenshot({ path: join(evidence, 'pure-completed-final.png') });
  const fastReplies: unknown[] = [];
  if (!forcePolling && dropEnd === 'none') {
    for (const path of ['REALTIME', 'RECEIPT'] as const) {
      const earlierIds = await page.evaluate(() => ((window as any).__xopcResponseLatencyMetrics() as { runId: string }[]).map(sample => sample.runId));
      fastPath = path;
      await composer.click();
      await page.keyboard.insertText(`FAST_FINAL_E2E_START_${path}: Reply with the fixture text immediately.`);
      await composer.press('Enter');
      const article = page.locator('article').filter({ hasText: `FAST_FINAL_E2E_RESULT_${path}.` }).last();
      await article.locator('[data-assistant-message-actions]').waitFor();
      const sample = await (await page.waitForFunction(previous =>
        ((window as any).__xopcResponseLatencyMetrics() as Array<{ runId: string; firstVisibleMs?: number }>)
          .find(row => !previous.includes(row.runId) && Number.isFinite(row.firstVisibleMs)), earlierIds)).jsonValue();
      assert.equal(sample.runAssociation, path === 'REALTIME' ? 'realtime' : 'history');
      assert.equal(sample.firstTextSource, 'history');
      assert.equal(sample.status, 'success');
      fastReplies.push(sample);
      fastPath = undefined;
    }
  }
  const associationSamples: { mode: 'realtime' | 'poll'; associationMs: number; firstVisibleMs: number;
    workspaceVerificationMs: number; gatewayPreparationMs: number }[] = [];
  if (benchmarkAssociation || benchmarkWorkspace) {
    let index = 0;
    for (let pair = 0; pair <= (benchmarkWorkspace ? 13 : 6); pair++) {
      const modes = benchmarkWorkspace ? ['realtime'] as const
        : pair % 2 ? ['poll', 'realtime'] as const : ['realtime', 'poll'] as const;
      for (const mode of modes) {
        associationMode = mode;
        const marker = ++index;
        const earlierIds = await page.evaluate(() => ((window as any).__xopcResponseLatencyMetrics() as { runId: string }[]).map(sample => sample.runId));
        await composer.click();
        await page.keyboard.insertText(`ASSOCIATION_BENCH_START_${marker}: Reply with the fixture text.`);
        await composer.press('Enter');
        const article = page.locator('article').filter({ hasText: `ASSOCIATION_BENCH_RESULT_${marker}.` }).last();
        await article.locator('[data-assistant-message-actions]').waitFor();
        const sample = await (await page.waitForFunction(previous =>
          ((window as any).__xopcResponseLatencyMetrics() as Array<{ runId: string; firstVisibleMs?: number }>)
            .find(row => !previous.includes(row.runId) && Number.isFinite(row.firstVisibleMs)), earlierIds)).jsonValue();
        assert.equal(sample.runAssociation, mode);
        assert.equal(sample.firstTextSource, 'realtime');
        if (pair >= (benchmarkWorkspace ? 2 : 1)) {
          const preparation = logs.split('\n').flatMap(line => {
            try { return [JSON.parse(line)]; } catch { return []; }
          }).find(entry => entry.runId === sample.runId && entry.phase === 'first_model_request');
          assert(Number.isFinite(preparation?.preparationTimings?.workspaceVerificationMs));
          if (process.argv.includes('--expect-deferred-workspace')) assert.equal(preparation.workspaceVerificationDeferred, true);
          associationSamples.push({ mode, associationMs: sample.runBoundMs - sample.inputAcceptedMs, firstVisibleMs: sample.firstVisibleMs,
            workspaceVerificationMs: preparation.preparationTimings.workspaceVerificationMs,
            gatewayPreparationMs: preparation.gatewayRunToFirstModelRequestMs });
        }
      }
    }
    associationMode = undefined;
  }
  const associationBenchmark = Object.fromEntries((['realtime', 'poll'] as const).map(mode => {
    const samples = associationSamples.filter(sample => sample.mode === mode);
    const summarize = (key: 'associationMs' | 'firstVisibleMs' | 'workspaceVerificationMs' | 'gatewayPreparationMs') => {
      const values = samples.map(sample => sample[key]).sort((a, b) => a - b);
      return { p50: values[Math.ceil(values.length * .5) - 1], p75: values[Math.ceil(values.length * .75) - 1] };
    };
    return [mode, { count: samples.length, associationMs: summarize('associationMs'), firstVisibleMs: summarize('firstVisibleMs'),
      workspaceVerificationMs: summarize('workspaceVerificationMs'), gatewayPreparationMs: summarize('gatewayPreparationMs') }];
  }));
  let personalIdleLatency: { firstVisibleMs: number; queueMs: number; preparationTimings: Record<string, number> } | undefined;
  if (verifyPersonalIdle) {
    const provision = await context.request.post(base + '/api/personal-agent', {
      headers: { Origin: base, 'Sec-Fetch-Site': 'same-origin' },
      data: { model: route.primary, displayName: 'Personal Lab', appearance: 'loopi' },
    });
    assert(provision.ok(), `Personal fixture provisioning failed: ${await provision.text()}`);
    const profile = await provision.json();
    assert.equal(profile.payload?.state, 'ready');
    const earlierIds = await page.evaluate(() => ((window as any).__xopcResponseLatencyMetrics() as { runId: string }[]).map(sample => sample.runId));
    await page.goto(base + '/#/personal');
    await composer.click();
    await page.keyboard.insertText('PERSONAL_IDLE_E2E_START: Give a short reply.');
    await composer.press('Enter');
    await page.getByText('PERSONAL_IDLE_E2E_RESULT. The idle reply is ready.', { exact: true }).waitFor();
    const sample = await (await page.waitForFunction(previous =>
      ((window as any).__xopcResponseLatencyMetrics() as Array<{ runId: string; firstVisibleMs?: number }>)
        .find(row => !previous.includes(row.runId) && Number.isFinite(row.firstVisibleMs)), earlierIds)).jsonValue();
    const personalLogs = logs.split('\n').flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    }).filter(entry => entry.runId === sample.runId);
    const text = personalLogs.find(entry => entry.phase === 'first_response_text');
    const preparation = personalLogs.find(entry => entry.phase === 'first_model_request');
    assert.equal(text?.conversationId, profile.payload.conversationId);
    assert(Number.isFinite(text?.queueMs));
    assert(Number.isFinite(preparation?.preparationTimings?.transcriptLoadMs));
    personalIdleLatency = { firstVisibleMs: sample.firstVisibleMs, queueMs: text.queueMs, preparationTimings: preparation.preparationTimings };
    await page.reload();
    const previousReply = page.getByText('PERSONAL_IDLE_E2E_RESULT. The idle reply is ready.', { exact: true });
    await previousReply.waitFor();
    await composer.click();
    await page.keyboard.insertText('PERSONAL_HISTORY_E2E_START: Follow up on the previous reply.');
    try {
      await composer.press('Enter');
      await page.locator('[data-chat-message-row]').filter({ hasText: 'PERSONAL_HISTORY_E2E_START' }).waitFor();
      await Promise.race([personalHistoryRequested, once(AbortSignal.timeout(10_000), 'abort').then(() => {
        throw new Error('Personal follow-up did not reach the model');
      })]);
      const { runId } = await (await page.waitForFunction(() => (window as any).__xopcResponseLatencyMetrics()
        .find((sample: { runBoundMs?: number }) => Number.isFinite(sample.runBoundMs)))).jsonValue() as { runId: string };
      assert(await previousReply.isVisible(), 'Sending removed the previous Personal reply');
      const personalConversationId = profile.payload.conversationId as string;
      const historyRoute = `${base}/api/sessions/${encodeURIComponent(personalConversationId)}/history?*`;
      await page.route(historyRoute, async route => {
        const response = await route.fetch();
        const body = await response.json();
        const users = body.session.messages.filter((message: { role: string; turnId?: string }) => message.role === 'user' && message.turnId !== runId);
        body.session.messages = [...users, {
          role: 'user', turnId: randomUUID(), timestamp: Date.now() - 1, content: 'A user row from a sparse history page.',
        }, {
          role: 'user', turnId: runId, timestamp: Date.now(), content: 'PERSONAL_HISTORY_E2E_START: Follow up on the previous reply.',
        }];
        await route.fulfill({ response, json: body, headers: { 'x-fixture-history': 'sparse' } });
      }, { times: 1 });
      const sparseHistory = page.waitForResponse(response => response.headers()['x-fixture-history'] === 'sparse');
      await page.evaluate(key => window.dispatchEvent(new CustomEvent('session-transcript-updated', { detail: { key } })), personalConversationId);
      await (await sparseHistory).finished();
      await page.waitForTimeout(250);
      assert(await previousReply.isVisible(), 'The previous Personal reply disappeared while waiting for the follow-up');
    } finally {
      releasePersonalHistory();
    }
    await page.getByText('PERSONAL_HISTORY_E2E_RESULT. The follow-up is ready.', { exact: true }).waitFor();
    assert(await previousReply.isVisible(), 'The previous Personal reply disappeared after the follow-up');
  }
  assert.equal(observed.pureReplies, 1);
  assert.deepEqual(errors, []); assert.deepEqual(observed.errors, []);
  assert.equal(observed.turns, 3);
  if (dropEnd !== 'none') assert(dropped.message >= 3);
  if (dropEnd === 'all') { assert(dropped.run >= 1); assert(dropped.sessions >= 1); }
  await Promise.all(['failure.png', 'failure.html', 'model.json'].map(name => rm(join(evidence, name), { force: true })));
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ ok: true, checks: ['production WebUI and authenticated Gateway', 'actual Agent file tools', 'live unclassified text outside process', 'streaming final Markdown table outside process', 'pure text streaming table without activity container', 'reasoning collapsed by default', 'consecutive tool aggregation', 'completion auto-collapse', 'public narration and result retain their order', 'completed process can reopen', 'SQLite history reload', 'narrow viewport', 'existing off/on/stream settings via UI', 'developer details toggle', 'simple/advanced settings preserved', 'clipboard contains only final result'], observed, dropEnd, dropped, responseLatency, fastReplies, forcePolling, associationSamples, associationBenchmark, personalIdleLatency }, null, 2));
  console.log(JSON.stringify({ ok: true, evidence, responseLatency, fastReplies, forcePolling, personalIdleLatency, ...((benchmarkAssociation || benchmarkWorkspace) ? { associationBenchmark } : {}) }));
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
  releaseProgress(); releaseResult(); releasePure(); releasePersonalHistory();
  model.closeAllConnections(); await new Promise<void>(r => model.close(() => r()));
  await rm(root, { recursive: true, force: true });
}
process.exit(0);
