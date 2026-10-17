// Real model + authenticated Gateway + full chat UI. Run with node --import tsx/esm.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

import playwright from 'playwright-core';

import { parseChartSpec } from '../packages/chart-spec/src/index.ts';
import { RealtimeClient } from '../packages/realtime-client/src/index.ts';
import { REALTIME_PROTOCOL_VERSION } from '../packages/realtime-protocol/src/index.ts';

const configPath = process.env.XOPC_CONFIG_PATH ?? join(homedir(), '.xopc/xopc.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const base = `http://127.0.0.1:${config.gateway.port ?? 18790}`;
const web = process.env.XOPC_CHART_LIVE_WEB ?? `${base}/`;
const directory = process.env.XOPC_CHART_LIVE_REPORT_DIR
  ? resolve(process.env.XOPC_CHART_LIVE_REPORT_DIR) : mkdtempSync(join(tmpdir(), 'xopc-chat-charts-live-'));
mkdirSync(directory, { recursive: true });
const workspace = mkdtempSync(join(tmpdir(), 'xopc-chart-agent-'));
const agentId = `chart-live-${randomUUID().slice(0, 8)}`;
const conversationId = randomUUID();
const report = { startedAt: new Date().toISOString(), passed: false, agentId, conversationId,
  prompt: '', events: [], toolCalls: [], models: [], charts: [], checks: [], errors: [], cleanup: {} };
const save = () => writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const safeError = error => String(error).replaceAll(config.gateway.auth.token, '[redacted]').replace(/sk-[\w.-]+/g, '[redacted]');
const step = message => { console.log(JSON.stringify({ step: message })); save(); };
const api = async (path, body, method) => {
  const response = await fetch(base + path, { method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { authorization: `Bearer ${config.gateway.auth.token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  const data = await response.json();
  assert.ok(response.ok, safeError(`${path}: HTTP ${response.status} ${JSON.stringify(data)}`));
  return data.payload ?? data;
};
const until = async (predicate, label, timeout = 180_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timeout: ${label}`);
};
let connected = false;
let created = false;
let browser;
let context;
let browserSession = false;
let db;
let runId;
let completion;
const clientId = `chart-observer-${randomUUID()}`;
const realtime = new RealtimeClient({ clientId, clientKind: 'tui',
  getWebSocketUrl: () => base.replace(/^http/, 'ws') + '/api/realtime/v1/ws',
  issueTicket: () => api('/api/realtime/tickets', { clientId, clientKind: 'tui', protocolVersion: REALTIME_PROTOCOL_VERSION }),
  createWebSocket: url => new WebSocket(url),
  onStateChange: state => { connected = state === 'connected'; },
  onEvent: event => {
    if (event.data?.conversationId !== conversationId) return;
    if (event.event === 'run.started') { runId = event.data.runId; realtime.subscribe(`run:${runId}`, 0); }
    if (event.event === 'run.completed') completion = event.data;
    if (['run.started', 'run.completed'].includes(event.event)) {
      report.events.push({ event: event.event, runId: event.data.runId, status: event.data.status });
      save();
    }
  },
});

try {
  const defaults = await api('/api/global-defaults');
  report.requestedModel = process.env.XOPC_CHART_LIVE_MODEL ?? defaults.defaults.models.chat.primary;
  const model = (await api('/api/models')).models.find(model => model.id === report.requestedModel);
  assert.ok(model, 'Configured model must be available');
  const thinkingLevel = model.thinking.initialValue;
  const catalog = await api('/api/skills');
  assert.ok(JSON.stringify(catalog).includes('chat-charts'), 'Gateway must discover the bundled chart skill');
  report.checks.push('Gateway catalog discovers chat-charts');
  await api('/api/agents', { id: agentId, workspace, profile: {
    name: 'Chart validation', description: 'Temporary assistant for chart acceptance testing.',
    creature: 'AI assistant', style: 'Clear and concise', language: 'zh',
  } });
  created = true;
  await api(`/api/agents/${agentId}`, {
    toolAllowlist: ['skills_list', 'skill_view'], runtime: { thinkingLevel },
  }, 'PATCH');
  await api(`/api/sessions/${conversationId}/materialize`, {
    commandId: randomUUID(), purpose: 'session_resources', creation: {
      agentId, projectId: null, execution: null, temporary: false,
      model: report.requestedModel, thinkingLevel,
    },
  });
  await until(async () => Boolean((await api(`/api/sessions/${conversationId}`)).session?.transcriptId), 'materialization', 30_000);
  await api(`/api/sessions/${conversationId}/agent-config`, { userContextMode: 'off', responseLanguage: 'auto' }, 'PATCH');
  realtime.subscribe('sessions'); realtime.connect();
  await until(() => connected, 'realtime connection', 20_000);
  step('temporary agent ready; inherited skills catalog; only skill reading tools enabled');

  browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
  const browserErrors = [];
  context.on('page', page => page.on('pageerror', error => browserErrors.push(error.message)));
  const exchange = await context.request.post(new URL('/api/browser-session', web).href, {
    headers: { authorization: `Bearer ${config.gateway.auth.token}`, origin: new URL(web).origin },
  });
  assert.ok(exchange.ok(), `Browser session: HTTP ${exchange.status()}`);
  browserSession = true;
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(`${web.replace(/\/$/, '')}/#/chat/${conversationId}`);
  const editor = page.locator('[role="textbox"][contenteditable="true"]:visible').last();
  await editor.waitFor();
  report.prompt = '请把下面的示例数据直接画在聊天里，不要生成单独的网页或文件。第一张用折线图比较三个月的收入和支出，第二张用柱状图比较支出类别。每张图后用一句中文解释。\n\n月度数据（单位：元）：2026-07 收入14320、支出9310；2026-08 收入15860、支出8840；2026-09 收入15140、支出9620。\n类别数据（单位：元）：房租4200、餐饮1860、交通540。\n这些数字仅用于演示，不是真实账本。';
  await editor.fill(report.prompt);
  const send = page.getByRole('button', { name: /^(Send|发送)$/ });
  await until(() => send.isEnabled(), 'composer draft ready', 15_000);
  const [accepted] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === `/api/sessions/${conversationId}/inputs`
      && response.request().method() === 'POST'),
    send.click(),
  ]);
  assert.ok(accepted.ok(), 'Chat UI input must be accepted');
  step('natural request submitted through full chat composer');
  await until(() => Boolean(completion), 'real agent completion');
  assert.equal(completion.status, 'success', JSON.stringify(completion));
  report.runId = runId;

  const session = (await api(`/api/sessions/${conversationId}`)).session;
  db = new DatabaseSync(join(process.env.XOPC_STATE_DIR ?? dirname(configPath), 'xopc.db'), { readOnly: true });
  const rows = db.prepare('SELECT role, payload_json FROM transcript_entries WHERE transcript_id=? ORDER BY seq').all(session.transcriptId);
  const messages = rows.map(row => ({ role: row.role, message: JSON.parse(row.payload_json) }));
  const assistant = messages.filter(row => row.role === 'assistant').map(row => row.message);
  report.models = [...new Set(assistant.map(message => `${message.provider}/${message.model}`))];
  report.toolCalls = assistant.flatMap(message => Array.isArray(message.content)
    ? message.content.filter(part => part.type === 'toolCall').map(part => ({ id: part.id, name: part.name, arguments: part.arguments })) : []);
  const answer = assistant.map(message => typeof message.content === 'string' ? message.content : (message.content ?? [])
    .filter(part => part.type === 'text').map(part => part.text).join('\n')).join('\n');
  writeFileSync(join(directory, 'answer.md'), answer);
  const reads = report.toolCalls.filter(call => call.name === 'skill_view' && call.arguments?.name === 'chat-charts');
  report.skillResults = messages.filter(row => row.role === 'toolResult' && reads.some(call => call.id === row.message.toolCallId))
    .map(row => {
      const call = reads.find(call => call.id === row.message.toolCallId);
      const content = (row.message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
      const path = call.arguments.path || 'SKILL.md';
      const expected = path === 'SKILL.md' ? '# Chat Charts' : path === 'references/chart-spec.md' ? '# ChartSpec v1'
        : path.startsWith('references/') && path.endsWith('-example.json') ? '"version": 1' : null;
      return { toolCallId: row.message.toolCallId, path, isError: row.message.isError === true,
        contentVerified: Boolean(expected && content.includes(expected)), preview: content.slice(0, 180) };
    });
  save();
  assert.ok(reads.some(call => !call.arguments.path || call.arguments.path === 'SKILL.md'), 'Agent must load SKILL.md on demand without a named-skill user hint');
  assert.ok(reads.some(call => call.arguments.path === 'references/chart-spec.md'), 'Agent must load the protocol reference');
  report.checks.push('Real agent independently loads chat-charts SKILL.md and protocol reference');
  assert.ok(report.skillResults.length >= 2 && report.skillResults.every(result => !result.isError && result.contentVerified),
    'Every chart skill read must return the intended file content, not an error message');
  const blocks = [...answer.matchAll(/^```chart\s*\n([\s\S]*?)^```\s*$/gm)].map(match => parseChartSpec(match[1]));
  assert.equal(blocks.length, 2, 'Must generate exactly two valid chart fences');
  const line = blocks.find(chart => chart.type === 'line');
  const bar = blocks.find(chart => chart.type === 'bar');
  assert.ok(line && bar);
  assert.deepEqual(line.series.map(series => series.values).sort(), [[14320, 15860, 15140], [9310, 8840, 9620]].sort());
  assert.deepEqual(bar.series.map(series => series.values), [[4200, 1860, 540]]);
  assert.ok(blocks.every(chart => chart.dataKind === 'example'));
  report.charts = blocks;
  report.checks.push('Generated line/bar payloads pass production parser and preserve supplied numbers');
  step('real tool trace and generated chart specs validated');

  await until(async () => await page.locator('[data-chart-block]').count() === 2, 'two charts in live chat', 30_000);
  const rendered = page.locator('[data-chart-block]');
  for (let index = 0; index < 2; index++) {
    const figure = rendered.nth(index);
    await figure.scrollIntoViewIfNeeded();
    await figure.locator('canvas').waitFor();
    const canvas = await figure.locator('canvas').evaluate(element => ({ width: element.width, height: element.height }));
    assert.ok(canvas.width > 0 && canvas.height > 0);
    await figure.screenshot({ path: join(directory, `${blocks[index].type}-live.png`) });
  }
  assert.equal(await page.locator('[data-chart-error]').count(), 0);
  report.checks.push('Both charts render real nonzero Canvas in the full streaming chat UI');
  await page.reload();
  for (let index = 0; index < 2; index++) {
    const figure = page.locator('[data-chart-block]').nth(index);
    await figure.scrollIntoViewIfNeeded();
    await figure.locator('canvas').waitFor();
  }
  report.checks.push('Both persisted charts render again after full chat reload');
  assert.deepEqual(browserErrors, []);
  report.browserErrors = browserErrors;
  report.passed = true;
  step('full chat rendering and persisted reload verified');
} catch (error) {
  report.errors.push(safeError(error));
  process.exitCode = 1;
} finally {
  if (browserSession) {
    const revoked = await context.request.delete(new URL('/api/browser-session', web).href, { headers: { origin: new URL(web).origin } }).catch(() => null);
    report.cleanup.browserSessionRevoked = revoked?.ok() === true;
  }
  await browser?.close();
  realtime.disconnect();
  db?.close();
  if (created) {
    try { await api(`/api/sessions/${conversationId}`, undefined, 'DELETE'); report.cleanup.conversationDeleted = true; }
    catch (error) { report.errors.push(safeError(error)); }
    try { await api(`/api/agents/${agentId}?purge=1`, undefined, 'DELETE'); report.cleanup.agentPurged = true; }
    catch (error) { report.errors.push(safeError(error)); }
  }
  rmSync(workspace, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  report.passed &&= report.errors.length === 0;
  save();
  console.log(JSON.stringify({ passed: report.passed, directory, models: report.models, checks: report.checks, errors: report.errors }));
  if (!report.passed) process.exitCode = 1;
}
