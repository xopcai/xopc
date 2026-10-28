/** Run after build:web. Real authenticated Gateway + SQLite + browser; model inference uses a local fixture. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Browser } from 'playwright-core';

const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');

const state = await mkdtemp(join(tmpdir(), 'xopc-evidence-'));
const workspace = join(state, 'workspace');
await mkdir(workspace);
Object.assign(process.env, {
  XOPC_STATE_DIR: state, XOPC_CONFIG_PATH: join(state, 'xopc.json'), XOPC_CONFIG: join(state, 'xopc.json'),
  XOPC_WORKSPACE: workspace, PI_CODING_AGENT_DIR: join(state, 'pi'), XOPC_LOG_LEVEL: 'fatal',
  XOPC_LOG_DIR: join(state, 'logs'), XOPC_SKIP_CHANNELS: '1',
});
const summary = '发布口径存在冲突，尚未确认；本次仅制作本地素材，不对外发布。';
let modelCalls = 0;
const model = createServer(async (req, res) => {
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const context = JSON.parse(body.messages.find((message: { role: string }) => message.role === 'user').content);
    modelCalls++;
    const evidenceIds = context.evidence.map((record: { id: string }) => record.id);
    const result = { state: 'ready', candidates: [{
      kind: 'delivery_risk', projectId: context.projects[0].id, title: '确认拾光发布口径',
      outcome: '形成可核对的本地发布口径清单。', rationale: '资料对发布意图描述不同，需先确认。',
      evidenceIds, evidenceGroups: [{ summary, evidenceIds }], confidence: 'high', urgency: 'today',
      risk: 'analysis', proposedSteps: ['核对资料并列出待确认项'], requiredCapabilities: [],
      verification: ['保留来源并明确不对外发布'], actionPrompt: '仅依据现有资料整理待确认项，不执行对外发布。',
    }] };
    const envelope = {
      id: randomUUID(), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'lab',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 100 },
    };
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ ...envelope, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ ...envelope, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    } else res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(envelope));
  } catch (error) { res.writeHead(500).end(String(error)); }
});
model.listen(0, '127.0.0.1'); await once(model, 'listening');
const modelPort = (model.address() as { port: number }).port;
const token = randomUUID();
await writeFile(join(state, 'models.json'), JSON.stringify({ providers: { 'evidence-lab': {
  baseUrl: `http://127.0.0.1:${modelPort}/v1`, apiKey: 'local-fixture', api: 'openai-completions',
  models: [{ id: 'lab', name: 'Evidence fixture', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 6000 }],
} } }));
await writeFile(join(state, 'xopc.json'), JSON.stringify({
  gateway: { bind: 'loopback', port: 24189, auth: { mode: 'token', token }, tailscale: { mode: 'off' } },
  browser: { enabled: false }, channels: {},
  userContext: { enabled: true, homeIntelligence: { enabled: true, refreshOnContextChange: false } },
}));

const { openXopcDatabase, getSqliteDatabase, closeXopcDatabase } = await import('../src/storage/sqlite/index.js');
const { seedTestAgentCatalog } = await import('../src/agent-catalog/test-support.js');
const { AgentDefaultsSchema } = await import('../src/agent-config/schema.js');
const { TaskContextRepository } = await import('../src/tasks/task-context-repository.js');
const { GatewayService } = await import('../src/gateway/service.js');
const { createHonoApp } = await import('../src/gateway/hono/app.js');
const { serve } = await import('@hono/node-server');
const { parseHomeResponse, HomeOpportunityHistoryResponseSchema } = await import('@xopcai/gateway-contract');
openXopcDatabase({ path: join(state, 'xopc.db') });
const route = { primary: 'evidence-lab/lab', fallbacks: [] };
seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: route, intents: { reasoning: route } } }),
  agents: [{ id: 'main', enabled: true, workspace }] });
const service = new GatewayService({ configPath: process.env.XOPC_CONFIG_PATH, listenPort: 24189, enableHotReload: false, taskDispatchEnabled: false });
let server: ReturnType<typeof serve> | undefined;
let browser: Browser | undefined;
try {
  await service.start();
  service.projects.create({ name: '拾光资料甲', brief: 'Source documents describe 拾光 as fictional and not for external release.' });
  service.projects.create({ name: '拾光资料乙', brief: 'A draft proposes introducing 拾光 publicly; the current task permits local preparation only.' });
  server = serve({ fetch: createHonoApp({ service }).fetch, hostname: '127.0.0.1', port: 24189 });
  server.on('upgrade', (req, socket, head) => { if (!service.realtime.handleUpgrade(req, socket, head)) socket.destroy(); });
  await once(server, 'listening'); service.markHttpListening();
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = async (path: string, data?: unknown) => {
    const response = await fetch(base + path, {
      method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    assert(response.ok, `${path}: ${response.status} ${await response.clone().text()}`);
    return response.json();
  };
  assert.equal((await fetch(base + '/api/home')).status, 401);
  await request('/api/home/advisor/refresh', { locale: 'zh', idempotencyKey: randomUUID() });
  let home = parseHomeResponse(await request('/api/home?locale=zh'));
  for (let i = 0; home.advisor.state !== 'ready' && i < 100; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    home = parseHomeResponse(await request('/api/home?locale=zh'));
  }
  assert(home.advisor.state === 'ready', JSON.stringify({ advisor: home.advisor, modelCalls }));
  const opportunity = home.advisor.primary;
  assert.equal(opportunity.evidencePresentation?.groups[0].summary, summary);
  assert.equal(opportunity.evidence.length, 2);
  assert(opportunity.evidence[0].observation.includes('Source') || opportunity.evidence[1].observation.includes('Source'));
  const callsAfterGeneration = modelCalls;
  const ui = base;
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addInitScript(() => {
    localStorage.setItem('xopc.language', 'zh');
    localStorage.setItem('xopc-onboarding-model-setup-dismissed', '1');
  });
  const auth = await context.request.post(ui + '/api/browser-session', {
    headers: { Authorization: `Bearer ${token}`, Origin: ui, 'Sec-Fetch-Site': 'same-origin' },
  });
  assert(auth.ok(), `browser session: ${auth.status()} ${await auth.text()}`);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(ui + '/#/');
  try {
    await page.getByText(summary, { exact: true }).waitFor();
  } catch (error) {
    console.error(JSON.stringify({ body: (await page.locator('body').innerText()).slice(0, 5000), pageErrors }));
    throw error;
  }
  const onboardingDismiss = page.getByRole('button', { name: '暂时不用，继续使用现有模型', exact: true });
  await onboardingDismiss.waitFor({ timeout: 5_000 }).catch(() => {});
  if (await onboardingDismiss.isVisible()) await onboardingDismiss.click();
  const discoveryDismiss = page.getByRole('button', { name: '暂时跳过', exact: true });
  await discoveryDismiss.waitFor({ timeout: 5_000 }).catch(() => {});
  if (await discoveryDismiss.isVisible()) await discoveryDismiss.click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.goto(ui + '/#/');
  await page.getByText(summary, { exact: true }).waitFor();
  await page.getByText('查看原始记录', { exact: false }).filter({ hasText: '2 条记录' }).click();
  assert(await page.getByText('打开来源', { exact: true }).first().isVisible());
  const screenshots = resolve('.xopc-evals/home-evidence');
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: join(screenshots, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => (document.getElementById('app-sidebar')?.getBoundingClientRect().right ?? 0) <= 1);
  assert(await page.getByText(summary, { exact: true }).isVisible());
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.getByText(summary, { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(screenshots, 'narrow.png') });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByText('打开来源', { exact: true }).first().click();
  await page.waitForURL(/\/#\/projects\//);
  await page.goBack();
  await page.getByText(summary, { exact: true }).waitFor();
  await page.getByRole('button', { name: '建议记录', exact: true }).first().click();
  const historyDialog = page.getByRole('dialog');
  await historyDialog.getByText(/查看.*依据/, { exact: true }).click();
  await historyDialog.getByText(summary, { exact: true }).waitFor();
  await historyDialog.getByText('查看原始记录', { exact: false }).filter({ hasText: '2 条记录' }).click();
  assert(await historyDialog.getByText('打开来源', { exact: true }).first().isVisible());
  await page.screenshot({ path: join(screenshots, 'history.png'), fullPage: true });
  await historyDialog.getByRole('button', { name: '关闭建议记录', exact: true }).click();
  await request('/api/home/advisor/history');
  assert.equal(modelCalls, callsAfterGeneration, 'Reading home, evidence and history must not call a model');
  const result = await request(`/api/home/opportunities/${opportunity.id}/action`, {
    mode: 'start', expectedRevision: opportunity.revision, idempotencyKey: randomUUID(),
  });
  assert.equal(result.outcome, 'task');
  const edges = new TaskContextRepository().list(result.taskId);
  assert.deepEqual(edges.map(edge => edge.targetId).sort(), opportunity.evidence.map(record => record.sourceRef).sort());
  assert.deepEqual(edges.map(edge => edge.metadata.evidenceId).sort(), opportunity.evidence.map(record => record.id).sort());
  const history = HomeOpportunityHistoryResponseSchema.parse(await request('/api/home/advisor/history'));
  assert.deepEqual(history.items.find(item => item.opportunity.id === opportunity.id)?.opportunity.evidencePresentation, opportunity.evidencePresentation);
  assert.equal(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM tasks').get()?.n, 1);
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ ok: true, state, modelCalls, evidenceRecords: edges.length, screenshots }));
} finally {
  await browser?.close();
  await service.stop();
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  closeXopcDatabase();
  model.closeAllConnections(); await new Promise<void>(resolve => model.close(() => resolve()));
}
process.exit(0);
