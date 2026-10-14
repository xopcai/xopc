/** Opt-in real-model Gateway verification using current model configuration and isolated synthetic data. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { serve } from '@hono/node-server';

assert.equal(process.env.XOPC_ALLOCATION_LIVE, '1', 'This script requires explicit authorization for real model usage');
const sourceRoot = process.env.XOPC_STATE_DIR ?? join(homedir(), '.xopc');
const credentialsDirectory = process.env.XOPC_CREDENTIALS_DIR ?? join(sourceRoot, 'credentials');
const sourceConfigPath = process.env.XOPC_CONFIG_PATH ?? join(sourceRoot, 'xopc.json');
const source = new DatabaseSync(join(sourceRoot, 'xopc.db'), { readOnly: true });
const settings = source.prepare('SELECT defaults_json FROM agent_catalog_settings WHERE singleton_id = 1').get() as { defaults_json: string };
const entries = source.prepare('SELECT id, enabled, profile_json, overrides_json FROM agents WHERE deleted_at IS NULL').all() as Array<{
  id: string; enabled: number; profile_json: string | null; overrides_json: string;
}>;
const personal = source.prepare("SELECT conversation_id, agent_id FROM sessions WHERE json_extract(custom_data_json, '$.personalAgent') = 1 LIMIT 1").get() as {
  conversation_id: string; agent_id: string;
};
assert.ok(personal, 'The current configuration must have a personal Agent');
const selection = source.prepare('SELECT model_override, fixed_model, thinking_level FROM session_config WHERE conversation_id = ?').get(personal.conversation_id) as {
  model_override: string; fixed_model: number; thinking_level: string | null;
};
source.close();
const directory = mkdtempSync(join(tmpdir(), 'xopc-personal-allocation-live-'));
const token = randomUUID();
const reportPath = resolve(process.env.XOPC_ALLOCATION_REPORT ?? 'docs/design/technical/personal-allocation-live-verification-2026-10-14.json');
const config = JSON.parse(readFileSync(sourceConfigPath, 'utf8'));
config.gateway = { ...config.gateway, auth: { mode: 'token', token }, tailscale: { mode: 'off' } };
if (config.tunnel) config.tunnel.enabled = false;
for (const channel of Object.values(config.channels ?? {}) as Array<Record<string, unknown>>) channel.enabled = false;
if (config.heartbeat) config.heartbeat.enabled = false;
config.userContext = { ...config.userContext, enabled: false };
const configPath = join(directory, 'xopc.json');
writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
// OAuth refresh tokens must never be cloned: share the existing credential path and its provider lock.
for (const folder of ['cache/model-catalog']) {
  const origin = join(sourceRoot, folder);
  if (existsSync(origin)) cpSync(origin, join(directory, folder), { recursive: true });
}
process.env.XOPC_STATE_DIR = directory;
process.env.XOPC_CONFIG_PATH = configPath;
process.env.XOPC_CONFIG = configPath;
process.env.XOPC_CREDENTIALS_DIR = credentialsDirectory;
process.env.XOPC_WORKSPACE = join(directory, 'workspace');
process.env.XOPC_LOG_DIR = join(directory, 'logs');
process.env.XOPC_LOG_LEVEL = 'warn';

const { openXopcDatabase, closeXopcDatabase, getSqliteDatabase, setSessionConfig } = await import('../src/storage/sqlite/index.js');
const { AgentCatalogRepository } = await import('../src/agent-catalog/repository.js');
const { createConversation } = await import('../src/storage/sqlite/conversation-repository.js');
const { GatewayService } = await import('../src/gateway/service.js');
const { createHonoApp } = await import('../src/gateway/hono/app.js');
const { AgentToolsFactory } = await import('../src/agent/tools/factory.js');
const { TaskApplicationService } = await import('../src/tasks/task-application-service.js');

openXopcDatabase({ path: join(directory, 'xopc.db') });
const db = getSqliteDatabase();
const catalog = new AgentCatalogRepository();
catalog.ensureInitialized(JSON.parse(settings.defaults_json));
for (const row of entries) {
  const workspace = join(directory, `workspace-${row.id}`);
  mkdirSync(workspace, { recursive: true });
  const entry = { id: row.id, enabled: row.enabled === 1, profile: row.profile_json ? JSON.parse(row.profile_json) : undefined,
    ...JSON.parse(row.overrides_json), workspace };
  const current = catalog.get(row.id);
  if (current) catalog.update(row.id, current.revision, entry);
  else catalog.create(entry, { ready: true });
  catalog.markProvisioned(row.id);
  for (const folder of ['profile']) {
    const origin = join(sourceRoot, 'agents', row.id, folder);
    if (existsSync(origin)) cpSync(origin, join(directory, 'agents', row.id, folder), { recursive: true });
  }
}
createConversation({ agentId: personal.agent_id, sourceChannel: 'webchat', name: 'Live allocation verification',
  hiddenFromSessionList: true, customData: { personalAgent: true, keepHiddenFromSessionList: true } }, directory, personal.conversation_id);
setSessionConfig(personal.conversation_id, { modelOverride: selection.model_override, fixedModel: true,
  thinkingLevel: selection.thinking_level as 'off' }, directory);

const timings: Record<string, number> = {};
const timeline: Array<{ stage: string; timestamp: string; elapsedMs: number }> = [];
let baseline = Date.now();
const mark = (stage: string, at = Date.now()) => {
  if (timings[stage] !== undefined) return;
  timings[stage] = at;
  const event = { stage, timestamp: new Date(at).toISOString(), elapsedMs: at - baseline };
  timeline.push(event);
  console.log(JSON.stringify(event));
};
const originalCreate = TaskApplicationService.prototype.create;
TaskApplicationService.prototype.create = function (...args) {
  const started = performance.now();
  const result = originalCreate.apply(this, args);
  if (args[0].activation.mode === 'allocate') {
    timings.submitHostMs = performance.now() - started;
    mark('taskPersisted');
  }
  return result;
};
const originalTools = AgentToolsFactory.prototype.createAllTools;
AgentToolsFactory.prototype.createAllTools = function (...args) {
  const tools = originalTools.apply(this, args);
  for (const tool of tools) if (tool.name === 'personal_task') {
    const execute = tool.execute;
    tool.execute = async function (...callArgs) {
      const isSubmit = (callArgs[1] as { command: string }).command === 'submit';
      const started = performance.now();
      if (isSubmit) mark('submitToolStarted');
      const result = await execute.apply(this, callArgs);
      if (isSubmit) { timings.submitToolMs = performance.now() - started; mark('submitToolReturned'); }
      return result;
    };
  }
  return tools;
};

const fixture = join(directory, 'shared', 'sales.csv');
mkdirSync(join(directory, 'shared'), { recursive: true });
writeFileSync(fixture, 'date,amount\n2026-01-01,100\n2026-01-15,50\n2026-02-01,120\n2026-02-15,90\n');
const marker = `LIVE-ALLOCATION-${randomUUID().slice(0, 8)}`;
const service = new GatewayService({ configPath, enableHotReload: false, listenPort: 0 });
let server: ReturnType<typeof serve> | undefined;
let taskId: string | undefined;
let report: Record<string, unknown> = {};
let failure: string | undefined;
try {
  const startup = performance.now();
  await service.start();
  timings.gatewayStartupMs = performance.now() - startup;
  const app = createHonoApp({ service });
  server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
    const payload = await response.json();
    if (!response.ok) throw new Error(`Gateway HTTP ${response.status}: ${JSON.stringify(payload)}`);
    return payload;
  };
  await api('/api/personal-agent');
  const append = async (clientMessageId: string, content: string) => {
    const session = db.prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id = ?').get(personal.conversation_id) as { active_transcript_id: string };
    const version = db.prepare('SELECT updated_at FROM session_config WHERE conversation_id = ?').get(personal.conversation_id) as { updated_at: number };
    return api(`/api/sessions/${personal.conversation_id}/inputs`, { kind: 'append', clientMessageId,
      expectedTranscriptId: session.active_transcript_id, configVersion: version.updated_at,
      delivery: 'next', input: { content }, origin: { type: 'system', source: 'cli' } });
  };
  baseline = Date.now();
  mark('requestSent');
  await append(`${marker}-task`, `这是实际执行任务 ${marker}：请安排有数据分析能力的执行者分析 ${fixture} 的月度销售额及环比。在执行者工作区创建 monthly_summary.csv、report.md 和 reproduce.mjs，实际运行脚本核验并把报告作为成果返回。验收：一月总额150、二月210、环比40%；报告说明统计口径并提供可复现脚本。允许读取此临时CSV、在本次隔离工作区写文件和运行计算脚本。不要在主对话手算代替执行，也不要等后台结束才回复。`);
  mark('requestAccepted');
  let pingSent = false;
  let lastState = '';
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    const task = db.prepare('SELECT task_id, created_at, delegate_agent_id, phase FROM tasks ORDER BY created_at LIMIT 1').get() as {
      task_id: string; created_at: number; delegate_agent_id: string | null; phase: string;
    } | undefined;
    if (task) {
      taskId = task.task_id;
      mark('taskPersisted', task.created_at);
      const allocation = db.prepare('SELECT status, updated_at, reason_code FROM task_allocations WHERE task_id = ?').get(taskId) as {
        status: string; updated_at: number; reason_code: string | null;
      };
      if (allocation.status === 'selecting') mark('allocationObserved');
      if (allocation.status === 'assigned') mark('assigned', allocation.updated_at);
      const run = db.prepare('SELECT run_id,status,queued_at,started_at,completed_at FROM task_runs WHERE task_id = ? ORDER BY queued_at DESC LIMIT 1').get(taskId) as {
        run_id: string; status: string; queued_at: number; started_at: number | null; completed_at: number | null;
      } | undefined;
      if (run) {
        mark('runQueued', run.queued_at);
        if (run.started_at) mark('runStarted', run.started_at);
        if (run.completed_at) mark('runCompleted', run.completed_at);
      }
      const state = `${allocation.status}/${run?.status ?? 'no-run'}`;
      if (state !== lastState) { console.log(JSON.stringify({ taskState: state, elapsedMs: Date.now() - baseline })); lastState = state; }
      const initial = db.prepare('SELECT status,updated_at_ms AS completed_at_ms FROM session_inputs WHERE conversation_id = ? AND client_message_id = ?').get(personal.conversation_id, `${marker}-task`) as { status: string; completed_at_ms: number | null };
      if (initial.status === 'completed') mark('personalInitialCompleted', initial.completed_at_ms ?? Date.now());
      if (!pingSent && initial.status === 'completed' && !run?.completed_at) {
        pingSent = true;
        mark('pingSent');
        await append(`${marker}-ping`, `现在只回复 ${marker}-READY，不要等待后台任务，不需要查询进度。`);
        mark('pingAccepted');
      }
      if (pingSent) {
        const ping = db.prepare('SELECT status,updated_at_ms AS completed_at_ms FROM session_inputs WHERE conversation_id = ? AND client_message_id = ?').get(personal.conversation_id, `${marker}-ping`) as { status: string; completed_at_ms: number | null };
        if (ping?.status === 'completed') mark('pingCompleted', ping.completed_at_ms ?? Date.now());
      }
      const delivery = db.prepare('SELECT status,reply_status,delivered_at FROM task_result_deliveries WHERE task_run_id = ?').get(run?.run_id ?? '') as {
        status: string; reply_status: string; delivered_at: number | null;
      } | undefined;
      if (delivery?.delivered_at) mark('resultPersisted', delivery.delivered_at);
      if (delivery?.reply_status === 'delivered') { mark('personalResultDelivered'); break; }
      if (['blocked', 'failed'].includes(allocation.status)) throw new Error(`Allocation ${allocation.status}: ${allocation.reason_code}`);
      if (run?.status === 'failed') throw new Error('Specialist execution failed');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(timings.personalResultDelivered, 'Timed out waiting for the result to return to the personal conversation');
  const allocation = db.prepare('SELECT selected_agent_id,selection_reason,attempts FROM task_allocations WHERE task_id = ?').get(taskId!) as { selected_agent_id: string; selection_reason: string; attempts: number };
  const history = await api(`/api/sessions/${personal.conversation_id}/history?view=compact`);
  assert.equal(allocation.selected_agent_id, 'data-analyst', 'The router should select the data Specialist for this synthetic task');
  assert.ok(timings.pingCompleted && timings.pingCompleted < timings.runCompleted, 'The main conversation must answer the ping before execution finishes');
  assert.ok(JSON.stringify(history).includes(`${marker}-READY`), 'The ping answer must appear in main history');
  const delivery = db.prepare('SELECT reply_text, payload_json FROM task_result_deliveries WHERE task_run_id IN (SELECT run_id FROM task_runs WHERE task_id = ?) ORDER BY delivered_at DESC LIMIT 1')
    .get(taskId!) as { reply_text: string | null; payload_json: string };
  assert.ok(delivery.reply_text?.trim(), 'A generated result reply must reach the main conversation');
  const workspace = catalog.get(allocation.selected_agent_id)!.workspace!;
  assert.ok(existsSync(join(workspace, 'report.md')), 'The analyst must create the requested report');
  const analysis = readFileSync(join(workspace, 'report.md'), 'utf8');
  assert.ok(analysis.includes('150') && analysis.includes('210') && analysis.includes('40'), 'The actual report must contain verified totals and growth');
  assert.ok(existsSync(join(workspace, 'reproduce.mjs')), 'The reproducible script must exist');
  const routerCalls = db.prepare("SELECT COUNT(*) AS count FROM ai_usage_events WHERE operation = 'task.allocation' AND status = 'succeeded'").get() as { count: number };
  assert.ok(routerCalls.count > 0, 'The real Task Router model must choose the executor; deterministic or user-selected bypass does not qualify');
  report = { ...report, allocation, history, resultReply: delivery.reply_text, reportContent: analysis,
    durationMs: { submitHost: timings.submitHostMs, submitTool: timings.submitToolMs,
      requestToSubmit: timings.taskPersisted - timings.requestSent,
      initialReplyAfterSubmit: timings.personalInitialCompleted - timings.submitToolReturned,
      allocation: timings.assigned - timings.taskPersisted,
      queue: timings.runStarted - timings.runQueued,
      execution: timings.runCompleted - timings.runStarted,
      resultReturn: timings.personalResultDelivered - timings.runCompleted,
      pingResponse: timings.pingCompleted - timings.pingSent,
      total: timings.personalResultDelivered - timings.requestSent } };
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ verificationFailure: failure }));
  process.exitCode = 1;
} finally {
  const task = taskId ? db.prepare('SELECT task_id,title,phase,delegate_agent_id FROM tasks WHERE task_id = ?').get(taskId) : undefined;
  const usage = db.prepare(`SELECT operation,provider,model,status,started_at,finished_at,duration_ms,input_tokens,output_tokens,reasoning_tokens,error_summary
    FROM ai_usage_events ORDER BY started_at`).all();
  const inputs = db.prepare('SELECT client_message_id,status,created_at_ms,updated_at_ms,error FROM session_inputs ORDER BY created_at_ms').all();
  report = { ...report, success: !failure, failure, marker, task,
    models: { personal: selection.model_override, global: JSON.parse(settings.defaults_json).models.chat.primary },
    timeline, rawTimings: timings, usage, inputs, isolatedStateDirectory: directory };
  mkdirSync(join(reportPath, '..'), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ reportPath, success: !failure }));
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  await service.stop();
  closeXopcDatabase();
  // The credential directory is shared; never delete it during isolated-state cleanup.
  rmSync(configPath, { force: true });
}
