// Run after completing the Store auth-lab authorization UI with synthetic accounts.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { RealtimeClient } from '../packages/realtime-client/src/index.js';
import { REALTIME_PROTOCOL_VERSION } from '../packages/realtime-protocol/src/index.js';

const config = JSON.parse(await readFile(join(homedir(), '.xopc/xopc.json'), 'utf8'));
const base = `http://127.0.0.1:${config.gateway.port ?? 18790}`;
const evidence = resolve(process.env.XOPC_AUTH_LAB_EVIDENCE ?? '/tmp/xopc-plugin-auth-live-e2e');
await mkdir(evidence, { recursive: true });
async function api(path: string, body?: unknown) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${config.gateway.auth.token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, `${path}: HTTP ${response.status}`);
  const result = await response.json();
  return result.payload ?? result;
}
async function until(check: () => boolean, label: string, timeout = 240_000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    assert(Date.now() < deadline, `Timeout: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
const conversationId = randomUUID();
const clientId = `plugin-auth-live-${randomUUID()}`;
let connected = false;
let completed: { status: string } | undefined;
let runId: string | undefined;
const realtime = new RealtimeClient({
  clientId, clientKind: 'tui',
  getWebSocketUrl: () => base.replace(/^http/, 'ws') + '/api/realtime/v1/ws',
  issueTicket: () => api('/api/realtime/tickets', { clientId, clientKind: 'tui', protocolVersion: REALTIME_PROTOCOL_VERSION }),
  createWebSocket: url => new WebSocket(url),
  onStateChange: state => { connected = state === 'connected'; },
  onEvent: event => {
    if (event.data?.conversationId !== conversationId) return;
    if (event.event === 'run.started') {
      runId = event.data.runId;
      realtime.subscribe(`run:${runId}`, 0);
    }
    if (event.event === 'run.completed') completed = event.data;
  },
});
try {
  const listing = await api('/api/extensions');
  const plugin = listing.extensions.find((entry: any) => entry.pluginId?.startsWith('xopc-plugin-auth-lab-'));
  assert(plugin, 'Install the auth-lab plugin from Store first');
  const setup = await api(`/api/extensions/agent-plugins/${plugin.pluginId}/setup`);
  assert.equal(setup.state, 'completed', 'Finish all four synthetic authorizations in the UI first');
  const defaults = await api('/api/global-defaults');
  const agents = await api('/api/agents');
  const model = defaults.defaults.models.chat.primary;
  const models = await api('/api/models');
  const entry = models.models.find((candidate: any) => candidate.id === model);
  assert(entry, 'Configured real model unavailable');
  realtime.subscribe('sessions');
  realtime.connect();
  await until(() => connected, 'realtime', 20_000);
  await api(`/api/sessions/${conversationId}/inputs`, {
    kind: 'start', clientMessageId: randomUUID(),
    creation: { agentId: agents.defaultAgentId ?? agents.default ?? 'main', projectId: null, execution: null, temporary: false, model, thinkingLevel: entry.thinking.initialValue },
    input: { content: '这是已授权的合成账号只读 E2E 测试。请发现并真实调用已安装 xopc-plugin-auth-lab 插件四个连接 token、client、cli、qr 各自的 read_authorized_record MCP 工具。必要时通过 searchTools 发现工具，禁止 shell、普通 exec、HTTP 或读取本机凭据来绕过插件。必须分别获得四个真实结果，不能编造。最终简洁列出四个记录 ID。' },
    origin: { type: 'system', source: 'cli' },
  });
  await until(() => !!completed, 'real Agent tool calls');
  assert.equal(completed?.status, 'success');
  const session = await api(`/api/sessions/${conversationId}?include=transcriptRows`);
  const messages = session.messages ?? session.session?.messages ?? [];
  const calls = messages.filter((message: any) => message.role === 'assistant').flatMap((message: any) => Array.isArray(message.content) ? message.content.filter((item: any) => item.type === 'toolCall') : []);
  const results = messages.filter((message: any) => message.role === 'toolResult' && !message.isError);
  const nested = results.flatMap((message: any) => message.nestedCalls?.calls ?? []);
  // Long MCP tool names are shortened by the runtime, so match the plugin namespace.
  const namespace = `mcp__plugin_${plugin.pluginId.replaceAll('-', '_')}_`;
  const toolCalls = [...calls, ...nested].filter((call: any) => call.name.startsWith(namespace) && (call.status === undefined || call.status === 'ok'));
  assert(new Set(toolCalls.map((call: any) => call.name)).size >= 4, 'Agent must actually call all four plugin tools');
  for (const kind of ['token', 'client', 'cli', 'qr']) {
    assert(results.some((result: any) => JSON.stringify(result.content).includes(`auth-${kind}-verified`)), `${kind}: actual tool result missing`);
  }
  const report = { passed: true, completedAt: new Date().toISOString(), conversationId, runId, pluginId: plugin.pluginId, model, toolNames: toolCalls.map((call: any) => call.name), verifiedRecords: ['token', 'client', 'cli', 'qr'] };
  await writeFile(join(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  realtime.disconnect();
}
