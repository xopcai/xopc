/** Opt-in real-model Gateway verification using current model configuration and isolated synthetic data. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { serve } from '@hono/node-server';

assert.equal(process.env.XOPC_STAGE_C_LIVE, '1', 'This script requires explicit authorization for real model usage');
const fingerprintPaths = ['src/personal-agent/result-reader.ts', 'src/personal-agent/result-extraction.ts',
  'src/personal-agent/result-read-continuations.ts', 'src/agent/tools/personal-result-tool.ts',
  'src/agent/source-context/result-context.ts', 'src/personal-agent/prompts.ts', 'src/personal-agent/policy.ts',
  'src/personal-agent/request-delivery.ts', 'src/session/session-context-for-llm.ts', 'src/gateway/service.ts',
  'src/storage/sqlite/migrations/251_personal_result_reads.sql', 'src/agent/tools/factory.ts',
  'web/src/features/chat/messages/message-bubble.tsx', 'web/src/features/chat/composer/chat-composer.tsx',
  'web/src/features/chat/messages/message-context-attachments.tsx', 'scripts/build-personal-result-worker.mjs',
  'scripts/build-electron-server.mjs', 'scripts/tsdown-build.mjs', 'tsdown.config.ts',
  'scripts/personal-task-revision-live-smoke.mts', 'src/tasks/task-handoff.ts', 'src/tasks/task-execution-capabilities.ts',
  'src/agent/service/direct-turn-helpers.ts', 'src/agent/service/process-direct-streaming.ts', 'src/agent/service/process-direct-one-shot.ts',
  'src/agent/tools/personal-task-tool.ts', 'src/agent/tools/xopc-use-tool.ts', 'src/tasks/task-application-service.ts', 'src/tasks/task-context-assembler.ts', 'src/tasks/task-allocation-service.ts', 'src/tasks/task-research-result.ts', 'src/tasks/task-contract-planner.ts',
  'src/agent/tools/task-evidence.ts', 'src/agent/tools/task-collaboration-tool.ts', 'src/agent/tools/task-result-tool.ts', 'src/tasks/task-run-dispatcher.ts', 'src/tasks/task-run-coordinator.ts', 'src/tasks/task-read-model-projector.ts', 'src/tasks/task-conversation-repository.ts', 'src/media/session-references.ts', 'src/agent/tools/task-evidence.ts', 'src/tasks/task-result-delivery-repository.ts', 'src/tasks/task-result-delivery-service.ts',
  'src/personal-agent/reply-composer.ts', 'src/personal-agent/communication.ts', 'src/storage/sqlite/migrations/252_task_work_revisions.sql',
  'packages/gateway-contract/src/task-result-delivery.ts', 'packages/gateway-contract/src/task-research-result.ts',
  'packages/gateway-contract/src/turn-outcome.ts', 'src/tasks/task-research-repair.ts', 'scripts/personal-task-revision-live-smoke.mts', 'pnpm-lock.yaml'];
const sourceFingerprint = () => Object.fromEntries(fingerprintPaths
  .map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
const initialSourceHashes = sourceFingerprint();
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
const directory = mkdtempSync(join(tmpdir(), 'xopc-personal-handoff-live-'));
const token = randomUUID();
const reportPath = resolve(process.env.XOPC_STAGE_C_REPORT ?? 'docs/design/technical/personal-task-revision-live-2026-10-15.json');
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
createConversation({ agentId: personal.agent_id, sourceChannel: 'webchat', name: 'Live result reading verification',
  hiddenFromSessionList: true, customData: { personalAgent: true, keepHiddenFromSessionList: true } }, directory, personal.conversation_id);
setSessionConfig(personal.conversation_id, { modelOverride: selection.model_override, fixedModel: true,
  thinkingLevel: selection.thinking_level as 'off' }, directory);

const { resultReferenceId, resultReferenceVersion } = await import('@xopcai/gateway-contract');
const { readPersonalResult, stopPersonalResultPreparations } = await import('../src/personal-agent/result-reader.js');
const marker = `RESULT-${randomUUID().slice(0, 8)}`;
const tailCode = `CEDAR-${randomUUID().slice(0, 8)}`;
const reportText = '# 第一节：背景\n' + '这是冻结的合成验收材料，不代表实际业务。\n'.repeat(700)
  + '\n# 第二节：方法\n这是文件阅读验收，不执行预测。\n'
  + `\n# 第三节：限定条件\n核对码：${tailCode}\n适用范围：仅适用于隔离验收样本，不适用于生产经营预测。\n`;
const tableText = 'month,total\n2026-01,150\n2026-02,210\n';
const verifyScript = `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
assert.equal(readFileSync('report.md', 'utf8'), readFileSync('source-report.md', 'utf8'));
assert.equal(readFileSync('monthly_summary.csv', 'utf8'), ${JSON.stringify(tableText)});
await new Promise(resolve => setTimeout(resolve, 8000));
console.log('Fixture files verified');\n`;
for (const agent of catalog.list({ readyOnly: true })) if (agent.workspace && agent.id === personal.agent_id) {
  writeFileSync(join(agent.workspace, 'source-report.md'), reportText);
  writeFileSync(join(agent.workspace, 'monthly_summary.csv'), tableText);
  writeFileSync(join(agent.workspace, 'reproduce.mjs'), verifyScript);
}
const toolCalls: Array<{ name: string; input: unknown; durationMs: number; output: unknown; failed?: boolean }> = [];
const originalTools = AgentToolsFactory.prototype.createAllTools;
AgentToolsFactory.prototype.createAllTools = function (...args) {
  const tools = originalTools.apply(this, args);
  if (args[0]?.conversationId === personal.conversation_id || args[0]?.agentId === personal.agent_id) {
    for (const tool of tools) {
      const execute = tool.execute;
      tool.execute = async function (...input) {
        const started = performance.now();
        try {
          const result = await execute.apply(this, input);
          toolCalls.push({ name: tool.name, input: input[1], durationMs: performance.now() - started, output: result.content });
          return result;
        } catch (error) {
          toolCalls.push({ name: tool.name, input: input[1], durationMs: performance.now() - started, output: String(error), failed: true });
          throw error;
        }
      };
    }
  }
  return tools;
};
const service = new GatewayService({ configPath, enableHotReload: false, listenPort: 0 });
let server: ReturnType<typeof serve> | undefined;
let result: Record<string, unknown> = {};
let failure: string | undefined;
try {
  await service.start();
  server = serve({ fetch: createHonoApp({ service }).fetch, hostname: '127.0.0.1', port: 0 });
  server.on('upgrade', (request, socket, head) => {
    if (service.voiceRealtime.handleUpgrade(request, socket, head)) return;
    if (service.realtime.handleUpgrade(request, socket, head)) return;
    socket.destroy();
  });
  if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
    const value = await response.json(); assert.ok(response.ok, `Gateway ${response.status}: ${JSON.stringify(value)}`); return value;
  };
  await api('/api/personal-agent');
  const append = async (name: string, content: string, contextRefs?: unknown[]) => {
    const session = db.prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id = ?').get(personal.conversation_id)!;
    const version = db.prepare('SELECT updated_at FROM session_config WHERE conversation_id = ?').get(personal.conversation_id)!;
    return api(`/api/sessions/${personal.conversation_id}/inputs`, { kind: 'append', clientMessageId: `${marker}-${name}`,
      expectedTranscriptId: session.active_transcript_id, configVersion: version.updated_at, delivery: 'next',
      input: { content, ...(contextRefs ? { contextRefs } : {}) }, origin: { type: 'system', source: 'cli' } });
  };
  const inputRow = (name: string) => db.prepare('SELECT id,status,error FROM session_inputs WHERE conversation_id = ? AND client_message_id = ?')
    .get(personal.conversation_id, `${marker}-${name}`);
  const until = async (predicate: () => boolean, timeout = 300_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const blocked = db.prepare("SELECT reason_code, selection_reason FROM task_allocations WHERE status IN ('blocked','failed') LIMIT 1").get();
      if (blocked) throw new Error(`Allocation blocked: ${JSON.stringify(blocked)}`);
      if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Timed out waiting for verification state');
  };
  const started = Date.now();
  const original = '请安排执行者交付已准备好的文件包：把工作区 source-report.md 原样复制为 report.md，运行现有 node reproduce.mjs 检查它和 monthly_summary.csv，然后只发布 report.md、monthly_summary.csv、reproduce.mjs 三个文件。文件及检查脚本已准备好，不需要新增分析、研究或改写。允许在隔离工作区复制文件、运行这个检查脚本并发布指定三文件。最终回复只说明交付情况，不复述文件正文或附录核对码。不要让主对话等待执行。';
  await append('publish', original);
  await until(() => inputRow('publish')?.status === 'completed' && Boolean(db.prepare("SELECT 1 FROM task_runs WHERE status = 'running'").get()));
  const pingStart = Date.now();
  await append('ping', `现在只回复 ${marker}-READY，不等待后台工作，不查询状态。`);
  await until(() => inputRow('ping')?.status === 'completed');
  const pingMs = Date.now() - pingStart;
  await until(() => Boolean(db.prepare("SELECT 1 FROM task_result_deliveries WHERE reply_status = 'delivered'").get()));
  const first = db.prepare('SELECT delivery_id,payload_json FROM task_result_deliveries LIMIT 1').get()!;
  const delivery = JSON.parse(String(first.payload_json));
  const report = delivery.outcome.deliverables.find((item: { title: string }) => item.title === 'report.md');
  assert.ok(report);
  assert.equal(delivery.outcome.status, 'succeeded', 'The first task must satisfy its deliverable criteria');
  const { getTaskHandoff } = await import('../src/tasks/task-handoff.js');
  const { savedExecutionRequirements, assertTaskExecutorReady } = await import('../src/tasks/task-execution-capabilities.js');
  assert.equal(getTaskHandoff(delivery.taskId)?.originalRequest, original);
  assert.ok(getTaskHandoff(delivery.taskId)?.sources.filter(source => source.kind === 'file').length === 3, 'All original file inputs must be scoped references');
  const needs = savedExecutionRequirements(delivery.taskId)!;
  assert.ok(needs.needs.some(item => item.capability === 'execute_code'));
  assert.ok(needs.needs.some(item => item.capability === 'publish_files'));
  const revisedCode = `MAPLE-${randomUUID().slice(0, 8)}`;
  const revisionRequest = `请修改刚才已完成的同一个任务，不要新建独立任务：基于刚才发布的 report.md，只将第三节核对码 ${tailCode} 改成 ${revisedCode}，其余 report.md 内容逐字保留。这个修订替换此前三文件交付要求，最终仅交付新版 report.md 与 changelog.txt 两个文件；changelog.txt 只写“核对码已由 ${tailCode} 更新为 ${revisedCode}，其他正文保持不变。” 不要交付旧 csv 或脚本，不要重跑原脚本；这是基于历史成果的文本修改，不重新研究。由后台执行者物化已发布 report.md 为只读输入、写入新的输出并校验除这一个码外其余内容未变。修改时必须保留旧成果可读。主对话保存修改后立即返回。`;
  const firstBytesResponse = await fetch(`${base}/api/media/read?uri=${encodeURIComponent(report.uri)}&conversationId=${personal.conversation_id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(firstBytesResponse.status, 200); const oldBytes = await firstBytesResponse.text(); assert.equal(oldBytes, reportText);
  await append('revision', revisionRequest);
  await until(() => Boolean(db.prepare('SELECT 1 FROM task_work_revisions').get()));
  const pingRevisionStart = Date.now();
  await append('revision-ping', `现在只回复 ${marker}-REVISION-READY，不等待后台工作，不查询状态。`);
  await until(() => inputRow('revision-ping')?.status === 'completed');
  const revisionPingMs = Date.now() - pingRevisionStart;
  await until(() => Number(db.prepare("SELECT count(*) AS n FROM task_result_deliveries WHERE reply_status = 'delivered'").get()!.n) === 2);
  const second = db.prepare('SELECT payload_json FROM task_result_deliveries WHERE delivery_id != ?').get(first.delivery_id)!;
  const next = JSON.parse(String(second.payload_json));
  assert.equal(next.taskId, delivery.taskId); assert.notEqual(next.taskRunId, delivery.taskRunId);
  assert.equal(next.resultRevision, 2); assert.equal(next.previousResultId, delivery.deliveryId);
  assert.ok(next.contractVersion > delivery.contractVersion);
  assert.equal(next.outcome.status, 'succeeded', 'The revised result must pass current acceptance');
  assert.deepEqual(next.outcome.deliverables.map((item: { title: string }) => item.title).sort(), ['changelog.txt', 'report.md']);
  const revisedReport = next.outcome.deliverables.find((item: { title: string }) => item.title === 'report.md');
  const revisedResponse = await fetch(`${base}/api/media/read?uri=${encodeURIComponent(revisedReport.uri)}&conversationId=${personal.conversation_id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(revisedResponse.status, 200); const revisedBytes = await revisedResponse.text();
  assert.equal(revisedBytes, reportText.replace(tailCode, revisedCode));
  const oldAgain = await fetch(`${base}/api/media/read?uri=${encodeURIComponent(report.uri)}&conversationId=${personal.conversation_id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(await oldAgain.text(), oldBytes);
  const revisionConversation = db.prepare('SELECT conversation_id FROM task_runs WHERE run_id = ?').get(next.taskRunId)!.conversation_id;
  const revisionCalls = db.prepare("SELECT e.payload_json FROM transcript_entries e JOIN transcripts t ON t.transcript_id=e.transcript_id WHERE t.conversation_id = ? AND role = 'assistant'").all(revisionConversation).flatMap(row => (JSON.parse(String(row.payload_json)).content ?? []).filter((part: { type: string }) => part.type === 'toolCall'));
  const revisionCommands = revisionCalls.filter((part: { name: string }) => part.name === 'exec_command').map((part: { arguments: { command?: string; cmd?: string } }) => part.arguments.command ?? part.arguments.cmd ?? '');
  assert.ok(!revisionCommands.some(command => /\bnode\s+[^\s;]*reproduce\.mjs\b/.test(command)), 'The current revision must not directly rerun the old script');
  assert.ok(next.adoption.some((item: { status: string; verification: string }) => item.status === 'applied' && item.verification === 'passed'));
  const oldBody = await readPersonalResult(personal.conversation_id, { command: 'get', resultId: delivery.deliveryId });
  const newBody = await readPersonalResult(personal.conversation_id, { command: 'get', resultId: next.deliveryId });
  assert.equal(oldBody.resultRevision, 1); assert.equal(newBody.resultRevision, 2);
  const transcript = db.prepare(`SELECT e.payload_json FROM transcript_entries e JOIN transcripts t ON t.transcript_id=e.transcript_id
    WHERE t.conversation_id != ? AND role='toolResult'`).all(personal.conversation_id).map(row => JSON.parse(String(row.payload_json)));
  const sourceReads = transcript.filter(row => row.toolName === 'task_collaboration' && row.details?.taskSourceRead);
  const materializationErrors = transcript.filter(row => row.isError && row.toolName === 'task_collaboration' && /materializ/i.test(JSON.stringify(row.content)));
  assert.equal(materializationErrors.length, 0);
  assert.ok(sourceReads.filter(row => row.details.taskSourceRead.materialized).length >= 4, 'Three workspace inputs and a pinned published report must be materialized');
  const sourceErrors = transcript.filter(row => row.toolName === 'publish_task_result' && row.isError && JSON.stringify(row.content).includes('source_quote_mismatch'));
  assert.ok(sourceErrors.length <= 2);
  assert.ok(!toolCalls.some(call => call.failed), 'Main tools must not fail');
  assert.ok(!toolCalls.some(call => ['read_file', 'read_media'].includes(call.name) || call.name === 'personal_result' && ['read', 'search'].includes((call.input as { command: string }).command)), 'Main conversation must not pre-read execution inputs');
  assert.equal(Number(db.prepare('SELECT count(*) AS n FROM tasks').get()!.n), 1);
  assert.equal(Number(db.prepare('SELECT count(*) AS n FROM task_runs WHERE parent_run_id IS NULL').get()!.n), 2);
  assert.equal(Number(db.prepare('SELECT count(*) AS n FROM task_work_revisions').get()!.n), 1);
  const reviseCall = toolCalls.find(call => call.name === 'personal_task' && (call.input as { command?: string }).command === 'revise');
  assert.ok(reviseCall, 'The actual main model must use the atomic revision command');
  result = { success: true, pingMs, revisionPingMs, totalMs: Date.now() - started,
    submissionMs: toolCalls.filter(call => call.name === 'personal_task' && ['submit', 'revise'].includes((call.input as { command?: string }).command ?? '')).map(call => ({ command: (call.input as { command: string }).command, durationMs: call.durationMs })),
    materializedInputCopies: sourceReads.filter(row => row.details.taskSourceRead.materialized).length, taskCount: 1, rootRunCount: 2,
    initialResult: { resultId: delivery.deliveryId, status: delivery.outcome.status, revision: delivery.resultRevision, sha256: report.sha256 },
    revisedResult: { resultId: next.deliveryId, status: next.outcome.status, revision: next.resultRevision, previousResultId: next.previousResultId,
      sha256: revisedReport.sha256, selectedArtifacts: next.outcome.deliverables.map((item: { title: string }) => item.title), adoption: next.adoption },
    oldArtifactUnchanged: true, exactSingleReplacement: true, noDirectOriginalScriptRerunObserved: true, mainInputPreReads: 0, materializationErrors: 0,
    sourceValidationRetries: sourceErrors.length,
    workerToolErrors: transcript.filter(row => row.isError).map(row => ({ tool: row.toolName, error: row.content })) };
} catch (error) {
  failure = error instanceof Error ? error.message : String(error); console.error(JSON.stringify({ failure })); process.exitCode = 1;
} finally {
  const sourceChangedDuringRun = JSON.stringify(initialSourceHashes) !== JSON.stringify(sourceFingerprint());
  if (sourceChangedDuringRun && !failure) { failure = 'Source changed during verification'; process.exitCode = 1; }
  result = { ...result, success: !failure, failure, marker, toolCalls,
    finalDeliveries: db.prepare('SELECT payload_json FROM task_result_deliveries ORDER BY created_at').all().map(row => JSON.parse(String(row.payload_json))),
    finalRuns: db.prepare('SELECT run_id,parent_run_id,status,contract_version,terminal_code,terminal_message FROM task_runs ORDER BY queued_at').all(),
    usage: db.prepare('SELECT operation,provider,model,status,duration_ms FROM ai_usage_events ORDER BY started_at').all(),
    isolatedStateDirectory: directory, models: { personal: selection.model_override, global: JSON.parse(settings.defaults_json).models.chat.primary },
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceHashes: initialSourceHashes,
    sourceChangedDuringRun, limitations: 'Real configured models and authenticated Gateway; isolated synthetic files. Registration and policy checks are not third-party network or binary parser readiness probes. Not production p95.' };
  mkdirSync(join(reportPath, '..'), { recursive: true }); writeFileSync(reportPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ reportPath, success: !failure }));
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  await service.stop(); await stopPersonalResultPreparations(); closeXopcDatabase();
  for (const name of readdirSync(directory)) if (name === 'xopc.json' || name.startsWith('xopc.json.')) rmSync(join(directory, name), { force: true });
}
process.exit(process.exitCode ?? 0);
