import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';

const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');
const evidence = resolve(process.env.XOPC_INPUT_CONTROL_EVIDENCE ?? `/tmp/xopc-chat-input-browser-${Date.now()}`);
await mkdir(evidence, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'xopc-input-browser-state-'));
console.log(JSON.stringify({ evidence, state: root }));
const requests: unknown[] = [], errors: string[] = [], checks: string[] = [];
const streams: Array<{ marker: string; finished: boolean; closed: boolean; release: () => void }> = [];
const model = createServer(async (req, res) => {
  let interval: ReturnType<typeof setInterval> | undefined;
  try {
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    const lastUser = (body.messages ?? []).filter((message: any) => message.role === 'user').at(-1);
    const marker = (body.tools?.length ? JSON.stringify(lastUser) : '').match(/INPUT_[A-Z0-9_]+/)?.[0];
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    const envelope = { id: randomUUID(), object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'lab' };
    const emit = (delta: unknown, finish_reason: string | null = null) => {
      if (!res.destroyed) res.write(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    };
    if (marker) {
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const stream = { marker, finished: false, closed: false, release };
      streams.push(stream);
      res.on('close', () => { stream.closed = true; release(); if (interval) clearInterval(interval); });
      emit({ role: 'assistant', content: `STREAM ${marker}. ` });
      let chunks = 0;
      interval = setInterval(() => { if (++chunks <= 12) emit({ content: `Step ${chunks}. ` }); }, 200);
      await gate;
      if (!res.destroyed) { stream.finished = true; emit({ content: `FINAL ${marker}.` }); emit({}, 'stop'); }
      clearInterval(interval);
    } else { emit({ role: 'assistant', content: 'Input control verification' }); emit({}, 'stop'); }
    res.end('data: [DONE]\n\n');
  } catch (error) { errors.push(`model: ${String(error)}`); res.end(); }
});
model.listen(0, '127.0.0.1'); await once(model, 'listening');
const modelPort = (model.address() as { port: number }).port;
const probe = createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>(done => probe.close(() => done()));
const base = `http://127.0.0.1:${port}`, token = randomUUID();
Object.assign(process.env, { XOPC_STATE_DIR: root, XOPC_CONFIG: join(root, 'xopc.json'), XOPC_CONFIG_PATH: join(root, 'xopc.json'),
  XOPC_MODELS_JSON: join(root, 'models.json'), XOPC_WORKSPACE: root, PI_CODING_AGENT_DIR: join(root, 'pi'),
  XOPC_CREDENTIALS_DIR: join(root, 'credentials'), XOPC_UI_STATIC_ROOT: resolve('dist/gateway/static/root'),
  XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1', XOPC_LOG_LEVEL: 'warn', XOPC_LOG_CONSOLE: 'false' });
const { ConfigSchema } = await import('../src/config/schema.js');
const { AgentDefaultsSchema } = await import('../src/agent-config/schema.js');
await writeFile(join(root, 'xopc.json'), JSON.stringify(ConfigSchema.parse({ gateway: { port, auth: { mode: 'token', token } }, userContext: { enabled: false } })));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { 'input-lab': { baseUrl: `http://127.0.0.1:${modelPort}/v1`, api: 'openai-completions', apiKey: 'synthetic-test-key',
  models: [{ id: 'lab', name: 'Input controlled stream', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 2048 }] } } }));
const { openXopcDatabase, closeXopcDatabase } = await import('../src/storage/sqlite/connection.js');
const { seedTestAgentCatalog } = await import('../src/agent-catalog/test-support.js');
openXopcDatabase();
seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: 'input-lab/lab' }, background: { primary: 'input-lab/lab' } }, runtime: { maxTurns: 8, timeoutMs: 180000, thinkingLevel: 'off' } }),
  agents: [{ id: 'main', enabled: true, workspace: root, profile: { name: 'Main', language: 'en' } }] });
closeXopcDatabase();
const child = spawn(process.execPath, ['dist/src/cli/bin.js', 'gateway', '--port', String(port), '--no-hot-reload'], { cwd: resolve('.'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '', browser: Browser | undefined, succeeded = false;
child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
const contexts: BrowserContext[] = [];
const socketEvents: Array<{ window: number; event: string }> = [];
const cleanupGates: Array<() => void> = [];
async function until(condition: () => Promise<boolean> | boolean, message: string, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await condition()) return; await new Promise(done => setTimeout(done, 100)); }
  throw new Error(message);
}
async function client() {
  const context = await browser!.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'en-US' });
  contexts.push(context);
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await context.addInitScript(() => localStorage.setItem('xopc.language', 'en'));
  const auth = await context.request.post(base + '/api/browser-session', { headers: { Authorization: `Bearer ${token}`, Origin: base, 'Sec-Fetch-Site': 'same-origin' } });
  assert(auth.ok(), `Auth: ${auth.status()}`);
  const dismissal = await context.request.patch(base + '/api/onboarding/work-discovery', { headers: { Origin: base, 'Sec-Fetch-Site': 'same-origin' }, data: { status: 'dismissed' } });
  assert(dismissal.ok(), `Onboarding dismissal: ${dismissal.status()}`);
  await context.request.put(base + '/api/models/cloud-onboarding', { headers: { Origin: base, 'Sec-Fetch-Site': 'same-origin' } });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const testWindow = window as typeof window & { acceptanceSockets: WebSocket[] };
    testWindow.acceptanceSockets = [];
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols); testWindow.acceptanceSockets.push(this);
      }
    };
  });
  page.on('websocket', socket => {
    socketEvents.push({ window: contexts.indexOf(context), event: 'open' });
    socket.on('close', () => socketEvents.push({ window: contexts.indexOf(context), event: 'close' }));
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => {
    const url = response.url(); const method = response.request().method();
    if (method !== 'GET' && /\/api\/sessions\/.*\/(?:inputs|replace|input-control)/.test(url)) {
      const body = response.request().postDataJSON();
      requests.push({ window: contexts.indexOf(context), path: new URL(url).pathname, status: response.status(), kind: body?.kind, action: body?.action,
        content: body?.input?.content ?? body?.content, clientMessageId: body?.clientMessageId, controlVersion: body?.controlVersion,
        expectedVersion: body?.expectedVersion, operationId: body?.operationId, response: await response.json().catch(() => null) });
    }
  });
  return { context, page };
}
const composer = (page: Page) => page.locator('[contenteditable="true"]').first();
async function open(page: Page, path = '/#/chat') {
  await page.goto(base + path);
  for (let i = 0; i < 50; i++) {
    for (const name of ['Maybe later, keep using my current model', 'Skip for now']) {
      const skip = page.getByRole('button', { name, exact: true });
      if (await skip.isVisible()) await skip.click({ timeout: 1000 }).catch(() => {});
    }
    if (await composer(page).isVisible() && !await page.locator('.xopc-onboarding-dialog').isVisible()) break;
    await page.waitForTimeout(200);
  }
  await composer(page).waitFor();
  await page.waitForTimeout(600);
}
async function type(page: Page, text: string) { await composer(page).fill(text); }
async function send(page: Page, text: string) {
  await type(page, text); await composer(page).press('Enter');
  await until(async () => (await composer(page).innerText()).trim() !== text, `Input was not accepted: ${text}`);
}
async function started(marker: string) { await until(() => streams.some(stream => stream.marker === marker), `Model did not start ${marker}`); }
function release(marker: string) { for (const stream of streams) if (stream.marker === marker) stream.release(); }
async function state(context: BrowserContext, id: string): Promise<any> {
  const res = await context.request.get(base + `/api/sessions/${id}/input-state`); assert(res.ok(), `Input state: ${res.status()}`); return (await res.json()).payload;
}
async function idle(context: BrowserContext, id: string) { await until(async () => !(await state(context, id)).activeRunId, 'Run did not become idle'); }
async function editUser(page: Page, marker: string) {
  const row = page.locator('article').filter({ has: page.getByText(marker, { exact: true }) });
  await row.hover(); await row.getByRole('button', { name: 'Edit in composer', exact: true }).click();
}
try {
  await until(async () => {
    if (child.exitCode !== null) throw new Error(`Gateway exited: ${logs.slice(-2500)}`);
    try { return (await fetch(base + '/health', { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
  }, 'Gateway startup timed out', 90000);
  browser = await chromium.launch({ headless: process.env.XOPC_INPUT_CONTROL_HEADLESS === '1', channel: process.env.XOPC_BROWSER_CHANNEL ?? 'chrome' });
  const a = await client(); await open(a.page);
  await send(a.page, 'INPUT_A'); await started('INPUT_A');
  await until(() => /#\/chat\/[a-f0-9-]{36}/.test(a.page.url()), 'Conversation URL not materialized');
  const id = a.page.url().match(/#\/chat\/([a-f0-9-]{36})/)![1];
  await until(() => a.page.getByText(/STREAM INPUT_A/).isVisible(), 'Stream not visible');
  await send(a.page, 'INPUT_F1'); await send(a.page, 'INPUT_F2');
  await until(async () => (await state(a.context, id)).inputs.filter((input: any) => input.status === 'queued').length === 2, 'Follow-ups were not queued');
  await a.page.getByRole('button', { name: 'Abort', exact: true }).click();
  await idle(a.context, id);
  assert((await state(a.context, id)).control.paused);
  assert.equal(streams.filter(stream => /INPUT_F[12]/.test(stream.marker)).length, 0);
  await editUser(a.page, 'INPUT_A');
  await until(async () => (await composer(a.page).innerText()).includes('INPUT_A'), 'Original message did not enter editor');
  await type(a.page, 'INPUT_A_EDIT'); await composer(a.page).press('Enter');
  await started('INPUT_A_EDIT');
  await until(async () => requests.some((request: any) => request.path.endsWith('/replace') && request.content === 'INPUT_A_EDIT'), 'Enter did not use replacement route');
  assert.equal(streams.filter(stream => /INPUT_F[12]/.test(stream.marker)).length, 0);
  release('INPUT_A_EDIT'); await idle(a.context, id);
  await a.page.screenshot({ path: join(evidence, '01-abort-edit-followups.png') });
  checks.push('Abort during output pauses two follow-ups; editing with Enter replaces the original turn');
  console.log(JSON.stringify({ check: checks.at(-1), id }));

  // Additional scenarios are kept in the same real conversation to exercise handoffs.
  const b = await client(); await open(b.page, new URL(a.page.url()).hash ? '/' + new URL(a.page.url()).hash : '/#/chat/' + id);
  await until(() => b.page.getByRole('button', { name: 'Resume queue', exact: true }).isVisible(), 'Second window did not hydrate pause');
  await type(a.page, 'UNSENT_DRAFT_A');
  await a.page.getByText('INPUT_F1', { exact: true }).click();
  await until(async () => (await composer(a.page).innerText()).includes('INPUT_F1'), 'Follow-up editor not open');
  await type(a.page, 'INPUT_F1_EDIT');
  await a.page.reload(); await composer(a.page).waitFor();
  await until(async () => (await composer(a.page).innerText()).includes('INPUT_F1_EDIT'), 'Refresh lost follow-up draft');
  await a.page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await until(async () => (await state(a.context, id)).inputs.some((input: any) => input.content === 'INPUT_F1_EDIT'), 'Follow-up save failed');
  await until(async () => (await composer(a.page).innerText()).includes('UNSENT_DRAFT_A'), 'Pre-edit draft was not restored');
  assert.equal(streams.filter(stream => stream.marker === 'INPUT_F1_EDIT').length, 0);
  await a.page.screenshot({ path: join(evidence, '02-refresh-followup.png') });
  checks.push('Refresh preserves follow-up editing, saving preserves pause and restores the prior unsent draft');
  console.log(JSON.stringify({ check: checks.at(-1) }));

  await b.page.getByRole('button', { name: 'Resume queue', exact: true }).click();
  await started('INPUT_F1_EDIT');
  release('INPUT_F1_EDIT'); await started('INPUT_F2');
  await until(() => a.page.getByText(/STREAM INPUT_F2/).isVisible(), 'First window did not resume the successor');
  const closedBefore = socketEvents.filter(event => event.window === 0 && event.event === 'close').length;
  const openedBefore = socketEvents.filter(event => event.window === 0 && event.event === 'open').length;
  await a.context.setOffline(true);
  await a.page.evaluate(() => {
    for (const socket of (window as typeof window & { acceptanceSockets: WebSocket[] }).acceptanceSockets) socket.close(4001, 'Acceptance disconnect');
  });
  await until(() => socketEvents.filter(event => event.window === 0 && event.event === 'close').length > closedBefore, 'Offline scenario did not close the real WebSocket');
  release('INPUT_F2');
  await idle(b.context, id);
  await a.context.setOffline(false);
  await until(() => socketEvents.filter(event => event.window === 0 && event.event === 'open').length > openedBefore, 'Browser did not open a new realtime connection');
  await until(async () => await a.page.getByRole('button', { name: 'Send', exact: true }).isVisible(), 'Reconnect did not converge to idle', 35000);
  await until(() => a.page.getByText(/FINAL INPUT_F2/).isVisible(), 'Reconnect did not recover persisted final text');
  await a.page.reload(); await composer(a.page).waitFor();
  await until(() => a.page.getByText(/FINAL INPUT_F2/).isVisible(), 'Refresh did not recover final text');
  await a.page.screenshot({ path: join(evidence, '03-reconnect-successor.png') });
  checks.push('Second window resumes queue in order; first window recovers successor completion after offline and refresh');
  console.log(JSON.stringify({ check: checks.at(-1) }));
  assert.equal(streams.filter(stream => stream.marker === 'INPUT_F1_EDIT').length, 1);
  assert.equal(streams.filter(stream => stream.marker === 'INPUT_F2').length, 1);

  await send(a.page, 'INPUT_C'); await started('INPUT_C');
  await send(a.page, 'INPUT_C_F1'); await send(a.page, 'INPUT_C_F2');
  await a.page.getByText('INPUT_C_F1', { exact: true }).click();
  await until(async () => (await composer(a.page).innerText()).includes('INPUT_C_F1'), 'Window A did not begin follow-up edit');
  await type(a.page, 'INPUT_C_F1_A');
  await until(() => b.page.getByText('INPUT_C_F1', { exact: true }).isVisible(), 'Window B did not hydrate queued row');
  await b.page.getByText('INPUT_C_F1', { exact: true }).click();
  await until(async () => (await composer(b.page).innerText()).includes('INPUT_C_F1'), 'Window B did not begin follow-up edit');
  await type(b.page, 'INPUT_C_F1_B');
  await composer(a.page).press('Enter');
  await until(async () => (await state(a.context, id)).inputs.some((input: any) => input.content === 'INPUT_C_F1_A'), 'Enter did not save follow-up during streaming');
  assert((await state(a.context, id)).activeRunId, 'Saving a follow-up stopped the active reply');
  await b.page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await until(async () => requests.some((request: any) => request.window === 1 && request.status === 409 && request.content === 'INPUT_C_F1_B'), 'Concurrent save did not report version conflict');
  assert.equal((await composer(b.page).innerText()).trim(), 'INPUT_C_F1_B');
  await b.page.getByRole('button', { name: 'Keep my changes and use the latest version', exact: true }).click();
  await b.page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await until(async () => (await state(a.context, id)).inputs.some((input: any) => input.content === 'INPUT_C_F1_B'), 'Explicit conflict resolution did not save');
  await b.page.screenshot({ path: join(evidence, '04-concurrent-edit.png') });
  checks.push('Two windows edit one queued row: stale save conflicts, keeps its draft, and requires explicit conflict resolution');
  console.log(JSON.stringify({ check: checks.at(-1) }));

  let releaseStopReply!: () => void;
  let stopAccepted = false;
  const stopReplyGate = new Promise<void>(resolve => { releaseStopReply = resolve; });
  cleanupGates.push(releaseStopReply);
  await a.page.route('**/api/sessions/*/input-control', async route => {
    if (route.request().postDataJSON().action !== 'stop') return route.continue();
    const response = await route.fetch(); stopAccepted = true;
    await stopReplyGate;
    await route.fulfill({ response });
  });
  await a.page.getByRole('button', { name: 'Abort', exact: true }).click();
  await until(() => stopAccepted, 'Server did not accept delayed stop');
  await until(async () => await b.page.getByRole('button', { name: 'Resume queue', exact: true }).isEnabled(), 'Peer did not observe stopped execution');
  await b.page.getByRole('button', { name: 'Resume queue', exact: true }).click();
  await started('INPUT_C_F1_B');
  await until(() => a.page.getByText(/STREAM INPUT_C_F1_B/).isVisible(), 'Window A did not observe successor while stop acknowledgement was delayed');
  releaseStopReply();
  await a.page.unroute('**/api/sessions/*/input-control');
  await a.page.waitForTimeout(300);
  assert((await state(a.context, id)).activeRunId, 'Late stop acknowledgement cleared successor');
  assert(!streams.find(stream => stream.marker === 'INPUT_C_F1_B')!.closed, 'Successor was aborted by old acknowledgement');
  assert.equal(await a.page.getByText('Request failed', { exact: true }).count(), 0, 'Control conflict was mislabeled as an agent failure');
  checks.push('A delayed stop acknowledgement cannot stop or clear the successor resumed by another window');
  console.log(JSON.stringify({ check: checks.at(-1) }));

  await a.page.getByText('INPUT_C_F2', { exact: true }).click();
  await until(async () => (await composer(a.page).innerText()).includes('INPUT_C_F2'), 'Pending successor did not enter editing');
  await type(a.page, 'LOCAL_C_F2_DRAFT');
  release('INPUT_C_F1_B'); await idle(b.context, id);
  await until(async () => await b.page.getByRole('button', { name: 'Resume queue', exact: true }).isEnabled(), 'Resume control did not become enabled');
  await b.page.getByRole('button', { name: 'Resume queue', exact: true }).click();
  await started('INPUT_C_F2');
  await until(() => a.page.getByText('The queue resumed elsewhere. Pause it again before saving this edit.', { exact: true }).isVisible(), 'Resumed queue did not invalidate editing hold');
  assert.equal((await composer(a.page).innerText()).trim(), 'LOCAL_C_F2_DRAFT');
  assert(await a.page.getByRole('button', { name: 'Save changes', exact: true }).isDisabled());
  await a.page.screenshot({ path: join(evidence, '05-peer-resume-edit.png') });
  await a.page.getByRole('button', { name: 'Use as a new message', exact: true }).click();
  await until(async () => (await composer(a.page).innerText()).includes('LOCAL_C_F2_DRAFT'), 'Explicit conversion lost the draft');
  await type(a.page, '');
  await b.page.reload(); await composer(b.page).waitFor();
  await until(() => b.page.getByText(/STREAM INPUT_C_F2/).isVisible(), 'Refreshing an active run did not restore output');
  assert.equal(streams.filter(stream => stream.marker === 'INPUT_C_F2').length, 1);
  release('INPUT_C_F2'); await idle(b.context, id);
  checks.push('Peer resume invalidates a restored edit hold without losing its draft; refreshing a running successor does not execute it twice');
  console.log(JSON.stringify({ check: checks.at(-1) }));

  await send(a.page, 'INPUT_D'); await started('INPUT_D');
  let lostReceipt = false;
  await a.page.route('**/api/sessions/*/inputs', async route => {
    if (route.request().postDataJSON().input?.content !== 'INPUT_D_F1') return route.continue();
    const response = await route.fetch(); assert.equal(response.status(), 202);
    requests.push({ fault: 'lost-response', clientMessageId: route.request().postDataJSON().clientMessageId });
    lostReceipt = true; await route.abort('failed');
  });
  await type(a.page, 'INPUT_D_F1'); await composer(a.page).press('Enter');
  await until(() => lostReceipt, 'Ambiguous receipt scenario did not reach the server');
  await until(async () => (await state(a.context, id)).inputs.some((input: any) => input.content === 'INPUT_D_F1'), 'Accepted follow-up was not persisted');
  assert.equal((await composer(a.page).innerText()).trim(), 'INPUT_D_F1');
  const durableCommands = await a.page.evaluate(() => new Promise<unknown[]>((resolve, reject) => {
    const request = indexedDB.open('xopc-session-drafts', 2);
    request.onsuccess = () => {
      const db = request.result; const read = db.transaction('commands').objectStore('commands').getAll();
      read.onsuccess = () => { resolve(read.result); db.close(); }; read.onerror = () => reject(read.error);
    }; request.onerror = () => reject(request.error);
  }));
  requests.push({ durableCommands });
  assert(durableCommands.some((command: any) => command.input?.content === 'INPUT_D_F1'), 'Lost-response command was not saved durably');
  await a.page.unroute('**/api/sessions/*/inputs');
  await a.page.reload(); await composer(a.page).waitFor();
  await until(async () => (await composer(a.page).innerText()).trim() === 'INPUT_D_F1', 'Unknown-receipt draft was lost on refresh');
  await composer(a.page).press('Enter');
  await until(async () => (await composer(a.page).innerText()).trim() !== 'INPUT_D_F1', 'Receipt retry did not settle the draft');
  assert.equal((await state(a.context, id)).inputs.filter((input: any) => input.content === 'INPUT_D_F1').length, 1, 'Retry after a lost receipt duplicated the follow-up');
  checks.push('An accepted follow-up with a lost HTTP response is recovered after refresh without duplicate queue insertion');
  console.log(JSON.stringify({ check: checks.at(-1) }));
  await a.page.getByRole('button', { name: 'Abort', exact: true }).click(); await idle(a.context, id);
  assert.equal(errors.length, 0, errors.join('\n'));
  succeeded = true;
} catch (error) {
  for (let i = 0; i < contexts.length; i++) for (const page of contexts[i].pages()) {
    await page.screenshot({ path: join(evidence, `failure-${i}.png`) }).catch(() => {});
    await writeFile(join(evidence, `failure-${i}.html`), await page.content()).catch(() => {});
  }
  errors.push(String(error));
  throw error;
} finally {
  for (const releaseGate of cleanupGates) releaseGate();
  await writeFile(join(evidence, 'gateway.log'), logs.replaceAll(token, '[test-token]'));
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ ok: succeeded, checks, errors, socketEvents, streams: streams.map(({ release: _release, ...stream }) => stream), requests }, null, 2));
  for (let i = 0; i < contexts.length; i++) await contexts[i].tracing.stop({ path: join(evidence, `trace-${i}.zip`) }).catch(() => {});
  await browser?.close();
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(done => setTimeout(done, 5000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
  for (const stream of streams) stream.release();
  model.closeAllConnections(); await new Promise<void>(done => model.close(() => done()));
  console.log(JSON.stringify({ ok: succeeded, evidence, checks }));
}
