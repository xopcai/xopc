// Real default Agent, inherited tools/skills, fresh conversations and production chat UI.
// Run: node --import tsx/esm scripts/verify-chat-charts-matrix.mjs
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

import playwright from 'playwright-core';

import { parseChartSpec } from '../packages/chart-spec/src/index.ts';
import { RealtimeClient } from '../packages/realtime-client/src/index.ts';
import { REALTIME_PROTOCOL_VERSION } from '../packages/realtime-protocol/src/index.ts';
import { assertChartCase, chartMatrixCases } from './chat-charts-matrix-cases.mjs';

const configPath = process.env.XOPC_CONFIG_PATH ?? join(homedir(), '.xopc/xopc.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const base = `http://127.0.0.1:${config.gateway.port ?? 18790}`;
const directory = process.env.XOPC_CHART_MATRIX_DIR ? resolve(process.env.XOPC_CHART_MATRIX_DIR)
  : mkdtempSync(join(tmpdir(), 'xopc-chart-matrix-'));
mkdirSync(directory, { recursive: true });
const selectedModels = (process.env.XOPC_CHART_MATRIX_MODELS
  ?? 'qwen-token-plan-cn/qwen3.8-flash,qwen-token-plan-cn/qwen3.8-max,deepseek/deepseek-v4-pro,minimax-cn/MiniMax-M2.7').split(',');
const selectedCases = chartMatrixCases.filter(scenario => !process.env.XOPC_CHART_MATRIX_CASES
  || process.env.XOPC_CHART_MATRIX_CASES.split(',').includes(scenario.id));
assert.ok(selectedCases.length, 'Select at least one known case');
const report = { startedAt: new Date().toISOString(), passed: false, setup: {}, cases: [], errors: [] };
const save = () => writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const log = stage => { console.log(JSON.stringify(stage)); save(); };
const safeError = error => String(error).replaceAll(config.gateway.auth.token, '[redacted]').replace(/sk-[\w.-]+/g, '[redacted]');
async function api(path, body, method) {
  const response = await fetch(base + path, { method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { authorization: `Bearer ${config.gateway.auth.token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  const data = await response.json();
  assert.ok(response.ok, safeError(`${path}: HTTP ${response.status} ${JSON.stringify(data)}`));
  return data.payload ?? data;
}
async function until(predicate, label, timeout = 180_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timeout: ${label}`);
}
const completions = new Map();
const runs = new Map();
let connected = false;
let browser;
let context;
let db;
let browserSession = false;
const clientId = `chart-matrix-${randomUUID()}`;
const realtime = new RealtimeClient({ clientId, clientKind: 'tui',
  getWebSocketUrl: () => base.replace(/^http/, 'ws') + '/api/realtime/v1/ws',
  issueTicket: () => api('/api/realtime/tickets', { clientId, clientKind: 'tui', protocolVersion: REALTIME_PROTOCOL_VERSION }),
  createWebSocket: url => new WebSocket(url),
  onStateChange: state => { connected = state === 'connected'; },
  onEvent: event => {
    const conversationId = event.data?.conversationId;
    if (!report.cases.some(test => test.conversationId === conversationId)) return;
    if (event.event === 'run.started') { runs.set(conversationId, event.data.runId); realtime.subscribe(`run:${event.data.runId}`, 0); }
    if (event.event === 'run.completed') completions.set(conversationId, event.data);
  },
});

try {
  const agents = await api('/api/agents');
  const agentId = agents.defaultId;
  assert.ok(agentId, 'Default Agent must exist');
  const effective = (await api(`/api/agents/${agentId}/effective-config`)).config;
  assert.equal(effective.skills.mode, 'all-enabled', 'Acceptance requires the normal full skills catalog');
  assert.ok(!effective.skills.exclude?.length, 'Do not hide skills for this acceptance');
  assert.equal(effective.toolAllowlist, undefined, 'Acceptance must not restrict the normal tool catalog');
  const catalog = await api('/api/skills');
  assert.ok(catalog.catalog.some(skill => skill.name === 'chat-charts'));
  const models = (await api('/api/models')).models;
  selectedModels.forEach(model => assert.ok(models.some(entry => entry.id === model), `${model} is not available`));
  report.setup = { agentId, toolAllowlist: null, skillMode: effective.skills.mode,
    skillCatalogCount: catalog.catalog.length, builtinToolCount: agents.builtinToolIds.length,
    selectedModels, selectedCases: selectedCases.map(scenario => scenario.id), configurationWrites: false };
  log({ stage: 'setup', directory, ...report.setup });
  db = new DatabaseSync(join(process.env.XOPC_STATE_DIR ?? dirname(configPath), 'xopc.db'), { readOnly: true });
  realtime.subscribe('sessions'); realtime.connect();
  await until(() => connected, 'realtime connection', 20_000);
  browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
  const exchange = await context.request.post(base + '/api/browser-session', {
    headers: { authorization: `Bearer ${config.gateway.auth.token}`, origin: base },
  });
  assert.ok(exchange.ok(), `Browser session HTTP ${exchange.status()}`);
  browserSession = true;
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));

  for (const modelId of selectedModels) for (const scenario of selectedCases) {
    const conversationId = randomUUID();
    const key = `${modelId.replaceAll('/', '--')}--${scenario.id}`;
    const folder = join(directory, key); mkdirSync(folder, { recursive: true });
    const test = { key, model: modelId, scenario: scenario.id, conversationId,
      startedAt: new Date().toISOString(), prompt: scenario.prompt, passed: false, checks: {}, toolCalls: [], skillReads: [], errors: [], cleanup: {} };
    report.cases.push(test);
    const errorOffset = browserErrors.length;
    log({ stage: 'case-start', key });
    try {
      const model = models.find(entry => entry.id === modelId);
      const thinkingLevel = effective.runtime.thinkingLevel ?? model.thinking.initialValue;
      assert.ok(model.thinking.options.includes(thinkingLevel), 'Agent thinking policy must be compatible with model');
      test.skillHash = createHash('sha256').update(readFileSync('skills/creative/chat-charts/SKILL.md')).digest('hex');
      await api(`/api/sessions/${conversationId}/materialize`, { commandId: randomUUID(), purpose: 'session_resources',
        creation: { agentId, projectId: null, execution: null, temporary: false, model: modelId, thinkingLevel } });
      await until(async () => Boolean((await api(`/api/sessions/${conversationId}`)).session?.transcriptId), 'materialization', 30_000);
      await page.goto(`${base}/#/chat/${conversationId}`);
      const editor = page.locator('[role="textbox"][contenteditable="true"]:visible').last();
      await editor.waitFor(); await editor.fill(scenario.prompt);
      const send = page.getByRole('button', { name: /^(Send|发送)$/ });
      await until(() => send.isEnabled(), 'draft ready', 15_000);
      const [accepted] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === `/api/sessions/${conversationId}/inputs`
          && response.request().method() === 'POST'), send.click(),
      ]);
      assert.ok(accepted.ok(), `Input HTTP ${accepted.status()}`);
      await until(() => completions.has(conversationId), `${key}: Agent completion`);
      test.runId = runs.get(conversationId);
      test.status = completions.get(conversationId).status;
      const session = (await api(`/api/sessions/${conversationId}`)).session;
      const messages = db.prepare('SELECT role, payload_json FROM transcript_entries WHERE transcript_id=? ORDER BY seq')
        .all(session.transcriptId).map(row => ({ role: row.role, message: JSON.parse(row.payload_json) }));
      const assistant = messages.filter(row => row.role === 'assistant').map(row => row.message);
      test.actualModels = [...new Set(assistant.map(message => `${message.provider}/${message.model}`))];
      const calls = assistant.flatMap(message => (message.content ?? []).filter?.(part => part.type === 'toolCall') ?? []);
      // Keep tool names and only chart-related read arguments, never unrelated source contents.
      test.toolCalls = calls.map(call => ({ name: call.name,
        ...((call.name === 'skill_view' && call.arguments?.name === 'chat-charts')
          || (call.name === 'read_file' && JSON.stringify(call.arguments).includes('chat-charts')) ? { arguments: call.arguments } : {}) }));
      for (const row of messages.filter(row => row.role === 'toolResult')) {
        const call = calls.find(call => call.id === row.message.toolCallId);
        if (!call || !['skill_view', 'read_file'].includes(call.name)) continue;
        const text = (row.message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
        const main = text.includes('# Chat Charts'); const reference = text.includes('# ChartSpec v1');
        if (main || reference) test.skillReads.push({ tool: call.name, file: main ? 'SKILL.md' : 'references/chart-spec.md',
          contentVerified: !row.message.isError });
      }
      const answer = assistant.map(message => typeof message.content === 'string' ? message.content
        : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n')).join('\n');
      writeFileSync(join(folder, 'answer.md'), answer);
      save();
      assert.equal(test.status, 'success', 'Real Agent must complete successfully');
      assert.deepEqual(test.actualModels, [modelId], 'Do not silently substitute a different model');
      test.checks.agent = true;
      const sources = [...answer.matchAll(/^```chart[^\S\n]*\n([\s\S]*?)^```[^\S\n]*$/gm)].map(match => match[1]);
      const specs = sources.map(source => parseChartSpec(source));
      test.charts = specs;
      assertChartCase(scenario, specs, answer);
      test.checks.data = true;
      if (scenario.type) {
        assert.ok(test.skillReads.some(read => read.file === 'SKILL.md' && read.contentVerified), 'Must load chart skill on demand');
        assert.ok(test.skillReads.some(read => read.file === 'references/chart-spec.md' && read.contentVerified), 'Must read chart protocol');
        test.checks.skill = true;
        const figure = page.locator('[data-chart-block]');
        await until(async () => await figure.count() === 1, 'inline chart', 20_000);
        await figure.scrollIntoViewIfNeeded(); await figure.locator('canvas').waitFor();
        assert.ok(await figure.locator('canvas').evaluate(canvas => canvas.width > 0 && canvas.height > 0));
        await figure.screenshot({ path: join(folder, 'chart.png') });
        assert.equal(await page.locator('[data-chart-error]').count(), 0);
        test.checks.render = true;
        await page.reload();
        await figure.scrollIntoViewIfNeeded(); await figure.locator('canvas').waitFor();
        test.checks.history = true;
      } else {
        assert.equal(await page.locator('[data-chart-block], [data-chart-error]').count(), 0);
        test.checks.safeFallback = true;
      }
      assert.deepEqual(browserErrors.slice(errorOffset), []);
      test.passed = true;
    } catch (error) {
      test.errors.push(safeError(error));
      test.runId ??= runs.get(conversationId);
      if (test.runId && !completions.has(conversationId)) {
        await api('/api/agent/abort', { runId: test.runId }).catch(() => {});
        await until(() => completions.has(conversationId), 'abort completion', 10_000).catch(() => {});
      }
    } finally {
      try { await api(`/api/sessions/${conversationId}`, undefined, 'DELETE'); test.cleanup.conversationDeleted = true; }
      catch (error) { test.cleanup.error = safeError(error); test.passed = false; }
      test.finishedAt = new Date().toISOString();
      test.elapsedMs = Date.parse(test.finishedAt) - Date.parse(test.startedAt);
      writeFileSync(join(folder, 'result.json'), JSON.stringify(test, null, 2) + '\n');
      log({ stage: 'case-finished', key, passed: test.passed, elapsedMs: test.elapsedMs, tools: test.toolCalls.map(call => call.name), errors: test.errors });
    }
  }
  report.passed = report.cases.length === selectedModels.length * selectedCases.length && report.cases.every(test => test.passed);
} catch (error) { report.errors.push(safeError(error)); }
finally {
  if (browserSession) {
    const response = await context.request.delete(base + '/api/browser-session', { headers: { origin: base } }).catch(() => null);
    report.browserSessionRevoked = response?.ok() === true;
    if (!report.browserSessionRevoked) { report.errors.push('Test browser session cleanup failed'); report.passed = false; }
  }
  await browser?.close(); realtime.disconnect(); db?.close();
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ stage: 'finished', directory, passed: report.passed,
    total: report.cases.length, passedCases: report.cases.filter(test => test.passed).length, errors: report.errors }));
  if (!report.passed) process.exitCode = 1;
}
