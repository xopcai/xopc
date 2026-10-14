/** Opt-in real-model Gateway verification using current model configuration and isolated synthetic data. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { serve } from '@hono/node-server';

assert.equal(process.env.XOPC_COLLABORATION_LIVE, '1', 'This script requires explicit authorization for real model usage');
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
const directory = mkdtempSync(join(tmpdir(), 'xopc-personal-collaboration-live-'));
const token = randomUUID();
const reportPath = resolve(process.env.XOPC_COLLABORATION_REPORT ?? 'docs/design/technical/personal-task-collaboration-live-verification-2026-10-14.json');
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
createConversation({ agentId: personal.agent_id, sourceChannel: 'webchat', name: 'Live collaboration verification',
  hiddenFromSessionList: true, customData: { personalAgent: true, keepHiddenFromSessionList: true } }, directory, personal.conversation_id);
setSessionConfig(personal.conversation_id, { modelOverride: selection.model_override, fixedModel: true,
  thinkingLevel: selection.thinking_level as 'off' }, directory);

const toolCalls: Array<{ name: string; command?: string; durationMs: number; failed: boolean; error?: string }> = [];
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
  const isMain = args[0]?.conversationId === personal.conversation_id || args[0]?.agentId === personal.agent_id;
  for (const tool of tools) if (isMain || tool.name === 'personal_task') {
    const execute = tool.execute;
    tool.execute = async function (...callArgs) {
      const command = (callArgs[1] as { command?: string }).command;
      const isSubmit = tool.name === 'personal_task' && command === 'submit';
      const started = performance.now();
      if (isSubmit) mark('submitToolStarted');
      try {
        const result = await execute.apply(this, callArgs);
        toolCalls.push({ name: tool.name, command, durationMs: performance.now() - started, failed: false });
        if (isSubmit) { timings.submitToolMs = performance.now() - started; mark('submitToolReturned'); }
        return result;
      } catch (error) {
        toolCalls.push({ name: tool.name, command, durationMs: performance.now() - started, failed: true,
          error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    };
  }
  return tools;
};

const fixtureContent = 'date,amount\n2026-01-01,100\n2026-01-15,50\n2026-02-01,120\n2026-02-15,90\n';
for (const agent of catalog.list({ readyOnly: true })) if (agent.workspace) writeFileSync(join(agent.workspace, 'sales.csv'), fixtureContent);
const marker = `LIVE-COLLABORATION-${randomUUID().slice(0, 8)}`;
const service = new GatewayService({ configPath, enableHotReload: false, listenPort: 0 });
let server: ReturnType<typeof serve> | undefined;
let taskId: string | undefined;
let report: Record<string, unknown> = {};
let failure: string | undefined;
try {
  const startup = performance.now();
  await service.start();
  timings.gatewayStartupMs = performance.now() - startup;
  server = serve({ fetch: createHonoApp({ service }).fetch, hostname: '127.0.0.1', port: 0 });
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
  const append = async (suffix: string, content: string) => {
    const session = db.prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id = ?').get(personal.conversation_id) as { active_transcript_id: string };
    const version = db.prepare('SELECT updated_at FROM session_config WHERE conversation_id = ?').get(personal.conversation_id) as { updated_at: number };
    return api(`/api/sessions/${personal.conversation_id}/inputs`, { kind: 'append', clientMessageId: `${marker}-${suffix}`,
      expectedTranscriptId: session.active_transcript_id, configVersion: version.updated_at,
      delivery: 'next', input: { content }, origin: { type: 'system', source: 'cli' } });
  };
  const inputCompleted = (suffix: string) => (db.prepare('SELECT status FROM session_inputs WHERE conversation_id = ? AND client_message_id = ?')
    .get(personal.conversation_id, `${marker}-${suffix}`) as { status: string } | undefined)?.status === 'completed';
  const { TaskCollaborationRepository } = await import('../src/tasks/task-collaboration-repository.js');
  const board = new TaskCollaborationRepository();
  baseline = Date.now();
  mark('requestSent');
  await append('task', `请安排数据分析执行者完成协作验证 ${marker}，分析工作区 sales.csv，币种明确为 CNY。生成 monthly_summary.csv、report.md、reproduce.mjs，运行脚本核验且发布报告。统计月度总额及环比。授权读取临时CSV、在隔离工作区写文件和运行脚本。此验证必须分阶段：执行者先通过 Task collaboration_post 问“请确认币种？”并暂停；Personal 应从本请求回答 CNY。恢复后，执行者再通过同一 Task 提问“请提供报告标签？”并暂停，标签目前未提供，主对话须询问我。在标签得到回答后，执行者确认回答并报告开始计算的进度，再用执行工具等待30秒模拟计算阶段以便我补充要求，然后读取并确认中途补充指令，将最新要求实际写入最终文件。不要替我决定标签。保持同一个Task和执行者。主对话快速提交后不要等执行结束。`);
  mark('requestAccepted');
  let pingSent = false;
  let readSent = false;
  let answerSent = false;
  let instructionSent = false;
  let lastState = '';
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    const task = db.prepare('SELECT task_id, created_at, phase FROM tasks ORDER BY created_at LIMIT 1').get() as { task_id: string; created_at: number; phase: string } | undefined;
    if (task) {
      taskId = task.task_id;
      mark('taskPersisted', task.created_at);
      const allocation = db.prepare('SELECT status, updated_at, reason_code FROM task_allocations WHERE task_id = ?').get(taskId) as { status: string; updated_at: number; reason_code: string | null };
      if (allocation.status === 'assigned') mark('assigned', allocation.updated_at);
      const run = db.prepare('SELECT run_id,status,queued_at,started_at,completed_at FROM task_runs WHERE task_id = ? ORDER BY queued_at DESC LIMIT 1').get(taskId) as {
        run_id: string; status: string; queued_at: number; started_at: number | null; completed_at: number | null;
      } | undefined;
      if (run?.started_at) mark('runStarted', run.started_at);
      if (run?.completed_at) mark('runCompleted', run.completed_at);
      if (inputCompleted('task')) mark('personalInitialCompleted');
      const entries = board.list(taskId, 0, 100);
      const currencyQuestion = entries.find(entry => entry.kind === 'question' && /币种|currency|CNY/i.test(entry.body));
      const currencyAnswer = entries.find(entry => entry.kind === 'answer' && entry.causationId === currencyQuestion?.id);
      const labelQuestion = entries.find(entry => entry.kind === 'question' && /标签|label/i.test(entry.body));
      const labelAnswer = entries.find(entry => entry.kind === 'answer' && entry.causationId === labelQuestion?.id);
      const instruction = entries.find(entry => entry.kind === 'instruction' && /735|双月汇总/.test(entry.body));
      if (currencyQuestion) mark('currencyQuestion', currencyQuestion.createdAt);
      if (currencyAnswer) mark('currencyAnswer', currencyAnswer.createdAt);
      if (currencyAnswer && ['delivered', 'confirmed'].includes(currencyAnswer.deliveryStatus ?? '') && run?.status === 'running') mark('currencyResumed');
      if (currencyAnswer?.deliveryStatus === 'confirmed') mark('currencyConfirmed');
      if (labelQuestion) mark('labelQuestion', labelQuestion.createdAt);
      if (labelAnswer) mark('labelAnswer', labelAnswer.createdAt);
      if (labelAnswer && ['delivered', 'confirmed'].includes(labelAnswer.deliveryStatus ?? '') && run?.status === 'running') mark('labelResumed');
      if (labelAnswer?.deliveryStatus === 'confirmed') mark('labelConfirmed');
      if (instruction) mark('instructionPersisted', instruction.createdAt);
      if (instruction?.deliveryStatus === 'delivered' || instruction?.deliveryStatus === 'confirmed') mark('instructionDelivered');
      if (instruction?.deliveryStatus === 'confirmed') mark('instructionConfirmed');
      const state = `${allocation.status}/${run?.status ?? 'no-run'}/${entries.map(e => `${e.kind}:${e.deliveryStatus ?? '-'}`).join(',')}`;
      if (state !== lastState) { console.log(JSON.stringify({ taskState: state, elapsedMs: Date.now() - baseline })); lastState = state; }
      const mainTrigger = labelQuestion ? db.prepare('SELECT status FROM session_inputs WHERE conversation_id = ? AND client_message_id = ?')
        .get(personal.conversation_id, `task-main-update:${labelQuestion.id}`) as { status: string } | undefined : undefined;
      if (!pingSent && mainTrigger?.status === 'completed') {
        mark('userQuestionPresented');
        pingSent = true;
        mark('pingSent');
        await append('ping', `先不要回答报告标签，也不要查询任务。现在只回复 ${marker}-READY，确认等待期间主对话仍可聊天。`);
      }
      if (pingSent && inputCompleted('ping')) {
        mark('pingCompleted');
        if (!readSent) {
          readSent = true;
          mark('stateReadSent');
          await append('read', '请读取原 Task 的完整状态，告诉我执行者是谁、目前在等待什么。不要替我决定报告标签，也不要创建新任务。');
        }
      }
      if (readSent && inputCompleted('read') && !answerSent) {
          mark('stateReadCompleted');
          answerSent = true;
          mark('userAnswerSent');
          await append('answer', '刚才执行者问的报告标签，答案是 春季观察。请把这个答案交回原任务，让执行者继续。');
      }
      if (!instructionSent && labelAnswer?.deliveryStatus === 'confirmed' && run?.status === 'running' && inputCompleted('answer')) {
        instructionSent = true;
        mark('instructionSent');
        await append('instruction', '补充原任务要求：标题改为 双月汇总，金额在展示及CSV中乘以2，新增双月合计720和校验码735；保留报告标签 春季观察 和币种CNY。脚本必须实际核验新口径，最终回复应说明采用了这些补充要求。继续原Task，不要新建任务。');
      }
      const delivery = db.prepare('SELECT reply_status FROM task_result_deliveries WHERE task_run_id = ?').get(run?.run_id ?? '') as { reply_status: string } | undefined;
      if (delivery?.reply_status === 'delivered') { mark('personalResultDelivered'); break; }
      if (['blocked', 'failed'].includes(allocation.status)) throw new Error(`Allocation ${allocation.status}: ${allocation.reason_code}`);
      if (run?.status === 'failed') throw new Error('Specialist execution failed');
    } else if (Date.now() - baseline > 30_000) throw new Error('No Task within 30 seconds');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(timings.personalResultDelivered, 'Timed out waiting for collaboration result');
  const entries = board.list(taskId!, 0, 100);
  report.board = entries;
  const allocation = db.prepare('SELECT selected_agent_id,selection_reason,attempts FROM task_allocations WHERE task_id = ?').get(taskId!) as { selected_agent_id: string; attempts: number };
  const history = await api(`/api/sessions/${personal.conversation_id}/history?view=compact`);
  const assistants = history.session.messages.filter((message: { role: string }) => message.role === 'assistant');
  report.history = history;
  assert.equal(allocation.selected_agent_id, 'data-analyst');
  assert.ok(assistants.some((message: { content: string }) => message.content.includes(`${marker}-READY`)), 'Main must answer while worker is waiting');
  assert.ok(timings.pingCompleted < timings.userAnswerSent && timings.pingCompleted < timings.runCompleted);
  assert.ok(timings.currencyAnswer < timings.userAnswerSent, 'Personal must answer known context without asking the user');
  assert.ok(timings.currencyConfirmed && timings.labelConfirmed && timings.instructionConfirmed, 'Worker must confirm both answers and mid-task instruction');
  const workspace = catalog.get(allocation.selected_agent_id)!.workspace!;
  const analysis = readFileSync(join(workspace, 'report.md'), 'utf8');
  const csv = readFileSync(join(workspace, 'monthly_summary.csv'), 'utf8');
  const script = readFileSync(join(workspace, 'reproduce.mjs'), 'utf8');
  report.reportContent = analysis; report.csv = csv; report.script = script;
  assert.ok(['双月汇总', '春季观察', 'CNY', '720', '735'].every(value => analysis.includes(value)), 'Final artifact must adopt supplemental requirements');
  assert.ok(csv.includes('300') && csv.includes('420'), 'Actual CSV must reflect multiplied amounts');
  const reply = db.prepare('SELECT reply_text, reply_payload_json FROM task_result_deliveries WHERE task_run_id IN (SELECT run_id FROM task_runs WHERE task_id = ?)').get(taskId!) as { reply_text: string; reply_payload_json: string };
  report.resultReply = reply.reply_text;
  const { TaskRunRepository } = await import('../src/tasks/task-run-repository.js');
  const runId = (db.prepare('SELECT run_id FROM task_runs WHERE task_id = ?').get(taskId!) as { run_id: string }).run_id;
  report.receipt = new TaskRunRepository().getReceipt(runId);
  report.compositionFallback = reply.reply_text === JSON.parse(reply.reply_payload_json).report;
  assert.equal(report.compositionFallback, false, 'Final verification requires successful Personal result composition');
  assert.ok(!/要我.{0,12}(?:确认接受|确认验收|直接接受)|(?:是否|要不要).{0,8}(?:验收|接受任务|关闭任务)/u.test(reply.reply_text), 'Result must not introduce an unsolicited acceptance decision');
  assert.ok(['双月汇总', '720', '735'].every(value => reply.reply_text.includes(value)), 'Main result must reflect the adopted requirement');
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM tasks').get() as { count: number }).count, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM task_runs').get() as { count: number }).count, 1);
  assert.equal(allocation.attempts, 1);
  assert.ok((db.prepare("SELECT COUNT(*) AS count FROM ai_usage_events WHERE operation = 'task.allocation' AND status = 'succeeded'").get() as { count: number }).count > 0, 'Real router must choose');
  assert.equal(toolCalls[0]?.command, 'submit', 'Main must submit before input inspection');
  assert.equal(toolCalls.filter(call => call.command === 'submit').length, 1);
  assert.ok(toolCalls.some(call => call.command === 'get'), 'Personal must read complete coordination state with its actual tool');
  assert.ok(toolCalls.some(call => call.command === 'answer') && toolCalls.some(call => call.command === 'instruct'));
  assert.ok(!toolCalls.some(call => call.failed));
  const executions = db.prepare(`SELECT e.payload_json FROM transcript_entries e WHERE e.role = 'toolResult'
    AND json_extract(e.payload_json, '$.toolName') = 'exec_command'
    AND json_extract(e.payload_json, '$.details.status') = 'success'`).all()
    .map(row => JSON.parse((row as { payload_json: string }).payload_json) as { details?: { command?: string } })
    .filter(result => /\bnode\s+(?:['"]?\.\/)?reproduce\.mjs/.test(result.details?.command ?? ''));
  assert.ok(executions.length > 0, 'Worker must actually run the verification script successfully');
  report.successfulScriptExecutions = executions.length;
  const toolErrors = (db.prepare(`SELECT COUNT(*) AS count FROM transcript_entries WHERE role = 'toolResult'
    AND json_extract(payload_json, '$.isError') = 1`).get() as { count: number }).count;
  assert.equal(toolErrors, 0, 'Main and executor must have no tool errors');
  report.toolErrors = toolErrors;
  assert.ok(timings.submitToolMs <= 250);
  assert.ok(timings.pingCompleted - timings.pingSent < 5000);
  report.allocation = allocation;
  report.durationMs = {
    submitTool: timings.submitToolMs, requestToSubmit: timings.taskPersisted - timings.requestSent,
    allocation: timings.assigned - timings.taskPersisted,
    knownQuestionToAnswer: timings.currencyAnswer - timings.currencyQuestion,
    knownAnswerToResume: timings.currencyResumed - timings.currencyAnswer,
    userAnswerToResume: timings.labelResumed - timings.userAnswerSent,
    mainStateRead: timings.stateReadCompleted - timings.stateReadSent,
    userAnswerToBoard: timings.labelAnswer - timings.userAnswerSent,
    instructionToBoard: timings.instructionPersisted - timings.instructionSent,
    instructionToConfirmation: timings.instructionConfirmed - timings.instructionSent,
    waitingMainResponse: timings.pingCompleted - timings.pingSent,
    resultReturn: timings.personalResultDelivered - timings.runCompleted,
    total: timings.personalResultDelivered - timings.requestSent,
  };
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ verificationFailure: failure }));
  process.exitCode = 1;
} finally {
  if (taskId) {
    const { TaskCollaborationRepository } = await import('../src/tasks/task-collaboration-repository.js');
    report.board = new TaskCollaborationRepository().list(taskId, 0, 100);
  }
  const usage = db.prepare('SELECT operation,provider,model,status,duration_ms,error_summary FROM ai_usage_events ORDER BY started_at').all();
  const inputs = db.prepare('SELECT client_message_id,status,created_at_ms,updated_at_ms,error FROM session_inputs ORDER BY created_at_ms').all();
  report = { ...report, success: !failure, failure, marker, taskId, models: { personal: selection.model_override, global: JSON.parse(settings.defaults_json).models.chat.primary },
    timeline, rawTimings: timings, toolCalls, usage, inputs, isolatedStateDirectory: directory };
  mkdirSync(join(reportPath, '..'), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ reportPath, success: !failure }));
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  await service.stop(); closeXopcDatabase(); rmSync(configPath, { force: true });
}
process.exit(process.exitCode ?? 0);
