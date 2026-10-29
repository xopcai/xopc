/** Opt-in live-model timing through an existing authenticated Gateway and Realtime client. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';

import { RealtimeClient } from '../packages/realtime-client/src/index.js';
import { REALTIME_PROTOCOL_VERSION } from '../packages/realtime-protocol/src/index.js';

assert.equal(process.env.XOPC_LIVE_LATENCY, '1', 'Set XOPC_LIVE_LATENCY=1 to authorize real model calls');
const arg = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const phase = arg('--phase');
assert.ok(phase === 'baseline' || phase === 'optimized', '--phase must be baseline or optimized');
const count = Number(arg('--count', '8'));
assert.ok(Number.isInteger(count) && count > 0 && count <= 24);
const warmups = Number(arg('--warmups', '2'));
assert.ok(Number.isInteger(warmups) && warmups >= 0 && warmups <= 4);
const state = process.env.XOPC_STATE_DIR ?? join(homedir(), '.xopc');
const config = JSON.parse(await readFile(process.env.XOPC_CONFIG_PATH ?? join(state, 'xopc.json'), 'utf8'));
const base = `http://127.0.0.1:${config.gateway?.port ?? 18790}`;
const token = process.env.XOPC_GATEWAY_TOKEN || config.gateway?.auth?.token;
assert.ok(token, 'Owner Gateway token is required');
const db = new DatabaseSync(join(state, 'xopc.db'), { readOnly: true });
const selection = db.prepare(`SELECT s.agent_id AS agentId,c.model_override AS model,c.thinking_level AS thinking
  FROM sessions s JOIN session_config c USING(conversation_id)
  WHERE json_extract(s.custom_data_json,'$.personalAgent')=1 ORDER BY s.created_at LIMIT 1`).get() as {
    agentId: string; model: string; thinking: string;
  };
db.close();
assert.ok(selection?.model && selection.thinking === 'off', 'Expected the existing Personal Agent model with thinking off');
const output = resolve(arg('--output', 'docs/design/technical/evidence/gateway-latency-live-2026-10-29.json')!);
let report: any;
try { report = JSON.parse(await readFile(output, 'utf8')); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
report ??= { createdAt: new Date().toISOString(), selection, base, observations: [],
  scope: 'Fresh temporary Personal Agent conversations on the real Gateway; HTTP send to Realtime first text and run_end. No browser rendering measurement.' };
assert.equal(report.selection.model, selection.model, 'Model changed between phases');
assert.ok(!report.observations.some((row: any) => row.phase === phase), 'Phase already has observations; use a fresh output file');
const save = async () => { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); };
const api = async (path: string, method = 'GET', body?: unknown) => {
  const response = await fetch(base + path, { method,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  const value = await response.json() as any;
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status} ${value.error?.code ?? ''}`);
  return value;
};
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (predicate: () => boolean, timeout = 15000) => {
  const deadline = performance.now() + timeout;
  while (!predicate()) { assert.ok(performance.now() < deadline, 'Timed out waiting for Gateway event'); await sleep(20); }
};
const image = async (color: string) => (await sharp({ create: { width: 64, height: 64,
  channels: 3, background: color } }).png().toBuffer()).toString('base64');
const red = await image('#ff0000'), blue = await image('#0000ff');
const allCases = [
  { name: 'ack', content: '只回复“收到”。', expected: /收到/ },
  { name: 'arithmetic', content: '计算 17 加 25，只回复结果。', expected: /42/ },
  { name: 'rewrite', content: '把“我已经完成了这项工作”改成一句自然的工作进展说明。', expected: /./u },
  { name: 'prioritize', content: '有三件事：今天到期的报销、下周的报告、整理照片。先做哪一件？只回复事项。', expected: /报销/ },
  { name: 'attachment_code', content: '读附件，只回复里面的核对码。', expected: /CEDAR-42/,
    attachments: [{ type: 'file', mimeType: 'text/plain', name: 'fixture.txt', data: Buffer.from('核对码：CEDAR-42。').toString('base64') }] },
  { name: 'attachment_sum', content: '把附件中的两个数相加，只回复结果。', expected: /42/,
    attachments: [{ type: 'file', mimeType: 'text/plain', name: 'numbers.txt', data: Buffer.from('17\n25\n').toString('base64') }] },
  { name: 'red_image', content: '这张纯色图片是什么颜色？只回复颜色名称。', expected: /红|red/i,
    attachments: [{ type: 'image', mimeType: 'image/png', name: 'red.png', data: red }] },
  { name: 'blue_image', content: '这张纯色图片是什么颜色？只回复颜色名称。', expected: /蓝|blue/i,
    attachments: [{ type: 'image', mimeType: 'image/png', name: 'blue.png', data: blue }] },
];
const cases = process.argv.includes('--vision-only')
  ? allCases.filter(row => row.name.endsWith('_image')) : allCases;
let connected = false;
let current: any;
const clientId = `latency-${randomUUID()}`;
const realtime = new RealtimeClient({ clientId, clientKind: 'tui',
  getWebSocketUrl: () => base.replace(/^http/, 'ws') + '/api/realtime/v1/ws',
  issueTicket: async () => (await api('/api/realtime/tickets', 'POST', { clientId,
    clientKind: 'tui', protocolVersion: REALTIME_PROTOCOL_VERSION })).payload,
  createWebSocket: url => new WebSocket(url),
  onStateChange: value => { connected = value === 'connected'; },
  onEvent: event => {
    const data = event.data as any;
    if (!current) return;
    if (event.event === 'run.started' && data.conversationId === current.conversationId) {
      current.runId = data.runId;
      realtime.subscribe(`run:${data.runId}`, 0);
    }
    if (!data.runId || data.runId !== current.runId) return;
    const elapsed = performance.now() - current.started;
    if (event.event === 'assistant_delta' && data.payload?.delta) {
      current.text += data.payload.delta;
      if (data.payload.delta.trim() && current.firstTextMs === undefined) current.firstTextMs = elapsed;
      current.lastTextMs = elapsed;
    }
    if (event.event === 'assistant_message_end') current.messageEndMs = elapsed;
    if (event.event === 'run_end') { current.completeMs = elapsed; current.status = data.payload?.status; }
  },
});

async function sample(index: number, warmup: boolean) {
  const scenario = cases[index % cases.length]!;
  const conversationId = randomUUID();
  const materialized = await api(`/api/sessions/${conversationId}/materialize`, 'POST', {
    commandId: randomUUID(), purpose: 'session_resources', creation: { agentId: selection.agentId,
      projectId: null, execution: null, temporary: true, model: selection.model, thinkingLevel: selection.thinking },
  });
  await api(`/api/sessions/${conversationId}`, 'PATCH', {
    name: `Latency probe ${phase} ${index}`, customData: { personalAgent: true,
      keepHiddenFromSessionList: true, latencyProbe: true },
  });
  const agentConfig = (await api(`/api/sessions/${conversationId}/agent-config`)).payload;
  const content = `这是临时性能测试，请直接回答，不使用工具、不安排任务、不保存记忆。\n${scenario.content}`;
  current = { conversationId, started: performance.now(), text: '' };
  let error: string | undefined;
  try {
    const receipt = await api(`/api/sessions/${conversationId}/inputs`, 'POST', {
      kind: 'append', clientMessageId: randomUUID(), expectedTranscriptId: materialized.payload.receipt.transcriptId,
      configVersion: agentConfig.configVersion, delivery: 'next',
      input: { content, ...('attachments' in scenario ? { attachments: scenario.attachments } : {}) },
      origin: { type: 'system', source: 'cli' },
    });
    const runId = receipt.payload.inputState.activeRunId;
    if (runId && !current.runId) { current.runId = runId; realtime.subscribe(`run:${runId}`, 0); }
    await until(() => current.completeMs !== undefined, 180_000);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'Probe failed';
    if (current.runId) await api('/api/agent/abort', 'POST', { runId: current.runId }).catch(() => {});
  }
  const observed = current;
  current = undefined;
  let trace: any;
  if (observed.runId) {
    for (let retry = 0; retry < 15; retry++) {
      const list = await api(`/api/observability/traces?runId=${encodeURIComponent(observed.runId)}`);
      const root = list.traces?.find((row: any) => row.name === 'agent.run');
      if (root?.endedAt) { trace = await api(`/api/observability/traces/${root.traceId}`); break; }
      await sleep(100);
    }
  }
  const root = trace?.spans?.find((row: any) => row.name === 'agent.run' && row.attributes['xopc.runId'] === observed.runId);
  const generations = trace?.spans?.filter((row: any) => row.type === 'generation'
    && ['agent.answer', 'agent.continue_after_tool'].includes(row.name)
    && row.attributes['xopc.runId'] === observed.runId) ?? [];
  const firstRequest = generations.length ? Math.min(...generations.map((row: any) => row.startedAt)) : undefined;
  const row = { phase, index, warmup, scenario: scenario.name, conversationId, runId: observed.runId,
    status: observed.status ?? 'failed', error, firstTextMs: observed.firstTextMs, lastTextMs: observed.lastTextMs,
    messageEndMs: observed.messageEndMs, completeMs: observed.completeMs,
    responseText: observed.text, qualityPassed: !error && observed.status === 'success' && scenario.expected.test(observed.text),
    traceId: root?.traceId, backendRunMs: root?.endedAt ? root.endedAt - root.startedAt : undefined,
    firstRequestOffsetMs: root && firstRequest !== undefined ? firstRequest - root.startedAt : undefined,
    traceLatency: root ? Object.fromEntries(Object.entries(root.attributes).filter(([key]) => key.startsWith('xopc.latency.'))) : {},
    modelCalls: generations.length, inputTokens: generations.reduce((n: number, row: any) => n + Number(row.attributes['gen_ai.usage.input_tokens'] ?? 0), 0),
    outputTokens: generations.reduce((n: number, row: any) => n + Number(row.attributes['gen_ai.usage.output_tokens'] ?? 0), 0),
    generationMs: generations.map((row: any) => row.endedAt - row.startedAt),
    promptHash: createHash('sha256').update(content).digest('hex'),
  };
  report.observations.push(row);
  await save();
  if (observed.runId) realtime.unsubscribe(`run:${observed.runId}`);
  // Retain diagnostic sessions and their traces, out of the active sidebar.
  await api(`/api/sessions/${conversationId}`, 'PATCH', { customData: { personalAgent: false } });
  await api(`/api/sessions/${conversationId}/archive`, 'POST', {});
  console.log(JSON.stringify({ phase, index, warmup, scenario: row.scenario, status: row.status,
    firstTextMs: row.firstTextMs, completeMs: row.completeMs, firstRequestOffsetMs: row.firstRequestOffsetMs,
    qualityPassed: row.qualityPassed }));
  assert.ok(!error, error);
}

try {
  assert.equal((await api('/api/health')).ready, true);
  report[`${phase}GatewayStatus`] = await api('/api/status');
  realtime.subscribe('sessions'); realtime.connect();
  await until(() => connected);
  for (let index = 0; index < warmups; index++) await sample(index, true);
  for (let index = 0; index < count; index++) await sample(index, false);
} finally {
  realtime.disconnect();
  await save();
}

const qualityFailures = report.observations.filter((row: { phase: string; warmup: boolean; qualityPassed: boolean }) =>
  row.phase === phase && !row.warmup && !row.qualityPassed);
if (qualityFailures.length > 0) {
  console.error(`${qualityFailures.length} response quality check(s) failed; inspect ${output}`);
  process.exitCode = 1;
}
