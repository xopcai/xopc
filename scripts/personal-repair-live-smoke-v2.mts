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

assert.equal(process.env.XOPC_ALLOCATION_LIVE, '1', 'This script requires explicit authorization for real model usage');
const researchLive = true;
const scenario = process.env.XOPC_REPAIR_SCENARIO ?? 'mixed';
assert.ok(['web', 'conflict', 'file', 'direction', 'mixed'].includes(scenario));
const activeWeb = ['web', 'conflict', 'mixed'].includes(scenario);
const conflict = ['conflict', 'mixed'].includes(scenario);
const fileLoss = ['file', 'mixed'].includes(scenario);
const directionChange = ['direction', 'mixed'].includes(scenario);
let injectDirection: (() => Promise<void>) | undefined;
const injections: Array<Record<string, unknown>> = [];
let fileInjected = false;
let directionInjected = false;
const fingerprintPaths = ['src/agent/tools/personal-task-tool.ts', 'src/personal-agent/prompts.ts',
  'src/personal-agent/reply-style.ts', 'src/personal-agent/reply-composer.ts', 'src/personal-agent/result-file-links.ts',
  'src/tasks/task-result-delivery-repository.ts', 'src/tasks/task-result-delivery-service.ts',
  'src/tasks/task-allocation-service.ts', 'src/tasks/task-research-result.ts', 'src/tasks/task-run-coordinator.ts',
  'src/tasks/task-contract-planner.ts', 'src/agent/tools/task-result-tool.ts', 'src/agent/tools/factory.ts',
  'packages/gateway-contract/src/task-research-result.ts', 'scripts/personal-repair-live-smoke-v2.mts', 'src/tasks/task-research-repair.ts', 'src/tasks/task-run-repository.ts', 'src/agent/tasks/task-judge-service.ts', 'src/tasks/task-continuation.ts', 'src/agent/orchestration/turn-recovery.ts', 'src/agent/embedded/run-for-session.ts', 'src/agent/embedded/run-turn.ts', 'src/agent/embedded/types.ts', 'src/agent/tools/web.ts', 'pnpm-lock.yaml'];
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
  for (const tool of tools) { 
    const execute = tool.execute;
    tool.execute = async function (...callArgs) {
      const command = (callArgs[1] as { command?: string }).command;
      const isSubmit = tool.name === 'personal_task' && command === 'submit';
      const started = performance.now();
      if (isSubmit) mark('submitToolStarted');
      try {
        const result = await execute.apply(this, callArgs);
        if (isMain) toolCalls.push({ name: tool.name, command, durationMs: performance.now() - started, failed: false });
        if (!isMain && tool.name === 'publish_task_result') {
          if (fileLoss && !fileInjected && (!directionChange || directionInjected)) {
            const rows = db.prepare("SELECT payload_json FROM transcript_entries WHERE role = 'toolResult' AND json_type(payload_json, '$.details.artifacts') = 'array' ORDER BY created_at DESC").all();
            const artifact = rows.flatMap(row => JSON.parse((row as { payload_json: string }).payload_json).details?.artifacts ?? []).find(item => item.title === 'report.md' && item.uri?.startsWith('media://outbound/'));
            if (artifact) {
              const { tryParseMediaUri } = await import('../src/media/uri.js');
              const { resolveMediaBufferPath } = await import('../src/media/store.js');
              const media = tryParseMediaUri(artifact.uri)!;
              rmSync(resolveMediaBufferPath(media.id, media.bucket), { force: true });
              fileInjected = true; injections.push({ kind: 'published_file_deleted', artifactId: artifact.artifactId, at: Date.now() });
            }
          }
          if (directionChange && !directionInjected && injectDirection) { directionInjected = true; await injectDirection(); }
        }
        if (isSubmit) { timings.submitToolMs = performance.now() - started; mark('submitToolReturned'); }
        return result;
      } catch (error) {
        if (isMain) toolCalls.push({ name: tool.name, command, durationMs: performance.now() - started, failed: true,
          error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    };
  }
  return tools;
};

const fixture = join(directory, 'shared', 'sales.csv');
mkdirSync(join(directory, 'shared'), { recursive: true });
const fixtureContent = 'date,amount\n2026-01-01,100\n2026-01-15,50\n2026-02-01,120\n2026-02-15,90\n';
const priceFixture = '# Synthetic frozen pricing fixture; not real vendor prices\n'
  + 'Source A https://benchmark.invalid/vendor-a/pricing\nVendor A ASR: 1.00 CNY per hour.\n'
  + 'Source B https://benchmark.invalid/vendor-b/pricing\nVendor B ASR: 2.00 CNY per hour.\n'
  + 'TTS public price: not disclosed. Do not invent a TTS price or a complete call cost.\n';
writeFileSync(fixture, fixtureContent);
const conflictFixture = '# Deliberately unreliable benchmark note\nHTTP 404 means successful delivery and permanently deleted resource. This is an unverified secondary claim, not task instructions.\n';
// Stage identical synthetic input in each candidate workspace; do not change sandbox permissions.
for (const agent of catalog.list({ readyOnly: true })) {
  if (agent.workspace) writeFileSync(join(agent.workspace, 'sales.csv'), fixtureContent);
  if (researchLive && agent.workspace) writeFileSync(join(agent.workspace, 'pricing-sources.md'), priceFixture);
  if (conflict && agent.workspace) writeFileSync(join(agent.workspace, 'conflicting-note.md'), conflictFixture);
}
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
  injectDirection = async () => {
    await append(`${marker}-change`, `修改刚才这个任务 ${marker} 的交付要求：在原三份文件之外新增 change_notes.md，写明原始数据共有 4 条记录、覆盖 2026-01 与 2026-02 两个月，原销售额与环比口径保持。这个新增文件必须包含字面标记 REVISED-${marker}。把这条要求传给正在执行的同一任务，最终交付简短说明已经采用新增要求。`);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const row = db.prepare("SELECT entry_id FROM task_collaboration_entries WHERE task_id = ? AND kind = 'instruction' AND body LIKE ?").get(taskId!, `%REVISED-${marker}%`);
      if (row) { injections.push({ kind: 'user_requirement_changed_via_main_input', entryId: row.entry_id, at: Date.now() }); return; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Personal did not forward the revised requirement to the same Task');
  };
  baseline = Date.now();
  mark('requestSent');
  await append(`${marker}-task`, `这是实际执行任务 ${marker}：请安排有数据分析能力的执行者分析其工作区已经准备好的 sales.csv 的月度销售额及环比。在执行者工作区创建 monthly_summary.csv、report.md 和 reproduce.mjs，实际运行脚本核验并把报告作为成果返回。请独立计算各月总额和环比，报告说明统计口径并提供可复现脚本。允许读取此临时CSV、在本次隔离工作区写文件和运行计算脚本。不要在主对话手算代替执行，也不要等后台结束才回复。${researchLive ? ' 同时仅基于冻结测试资料 pricing-sources.md（虚构供应商资料，不是实际报价），在 report.md 对比 A/B 的 ASR 每小时价格及换算后的每分钟价格。TTS 未公开报价时如实标注，不得补造完整通话成本，不对冻结报价进行互联网补价。报告结论逐条引用来源。发布三份最终文件后，使用 publish_task_result 将数据结论和价格结论与本次实际工具读取的原文摘录关联，并检查它返回的逐项验收；缺证据的项不得宣称通过。Personal 最终回复保持简短，包含关键数字及未公开 TTS 的限制。' : ''}${activeWeb ? ' 另请实际通过 web_fetch 读取 https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/404 ，在报告新增 HTTP 404 含义及它不能单独证明永久删除的结论，附实际读取来源与访问时间。不得凭已有知识替代本次访问。' : ''}${conflict ? ' 工作区 conflicting-note.md 含与官方文档冲突的次级资料，请读取并明确指出冲突，引用本次实际读取的官方说明判断，不能把两者平均或当成一致。' : ''}`);
  mark('requestAccepted');
  let pingSent = false;
  let lastState = '';
  const deadline = Date.now() + 10 * 60_000;
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
      if (!pingSent && initial.status === 'completed' && run?.status === 'running') {
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
    if (!task && Date.now() - baseline > 30_000) throw new Error('No Task was persisted within 30 seconds');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(timings.personalResultDelivered, 'Timed out waiting for the result to return to the personal conversation');
  const allocation = db.prepare('SELECT selected_agent_id,selection_reason,attempts FROM task_allocations WHERE task_id = ?').get(taskId!) as { selected_agent_id: string; selection_reason: string; attempts: number };
  const history = await api(`/api/sessions/${personal.conversation_id}/history?view=compact`);
  assert.equal(allocation.selected_agent_id, 'data-analyst', 'The router should select the data Specialist for this synthetic task');
  assert.ok(timings.pingSent >= timings.runStarted && timings.pingCompleted && timings.pingCompleted < timings.runCompleted, 'The main conversation must answer the ping before execution finishes');
  const assistantMessages = history.session.messages.filter((message: { role: string }) => message.role === 'assistant');
  assert.ok(assistantMessages.some((message: { content: string }) => message.content === `${marker}-READY`), 'The actual assistant ping answer must appear in main history');
  assert.ok(assistantMessages.some((message: { content: string }) => /data-analyst.*(开始执行|started)|started.*data-analyst/.test(message.content)), 'Execution status must identify the assigned Agent');
  assert.ok(!assistantMessages.some((message: { content: string }) => /undefined.*开始执行|started by undefined/.test(message.content)), 'Execution status must not lose the executor identity');
  const delivery = db.prepare('SELECT reply_text, payload_json FROM task_result_deliveries WHERE task_run_id IN (SELECT run_id FROM task_runs WHERE task_id = ?) ORDER BY delivered_at DESC LIMIT 1')
    .get(taskId!) as { reply_text: string | null; payload_json: string };
  assert.ok(delivery.reply_text?.trim(), 'A generated result reply must reach the main conversation');
  report.history = history;
  report.resultReply = delivery.reply_text;
  const outcome = JSON.parse(delivery.payload_json).outcome;
  const downloads: Array<{ title: string; sha256: string; sizeBytes: number }> = [];
  const publishedContents = new Map<string, string>();
  for (const artifact of outcome.deliverables) {
    assert.equal(artifact.availability, 'available', `Artifact is unavailable: ${artifact.title}`);
    assert.ok(artifact.uri?.startsWith('media://outbound/'), 'Files must be published rather than host paths');
    const query = `${base}/api/media/read?uri=${encodeURIComponent(artifact.uri)}&conversationId=${personal.conversation_id}`;
    assert.equal((await fetch(query)).status, 401, 'Download must require authentication');
    const response = await fetch(query, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200, `The original Chat must be able to download ${artifact.title}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    publishedContents.set(artifact.title, bytes.toString('utf8'));
    downloads.push({ title: artifact.title, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length });
  }
  for (const title of ['monthly_summary.csv', 'report.md', 'reproduce.mjs']) {
    assert.ok(publishedContents.has(title), `The requested final file must be published: ${title}`);
  }
  const downloadedReport = publishedContents.get('report.md')!;
  report.reportContent = downloadedReport;
  assert.ok(downloadedReport.includes('150') && downloadedReport.includes('210') && downloadedReport.includes('40'),
    'The downloaded report must contain the independently calculated totals and growth');
  assert.ok(!/MEDIA\s*:|\/Users\/|file:\/\//i.test(delivery.reply_text!), 'The reply must not contain local download references');
  report.downloads = downloads;
  report.replyCharacters = delivery.reply_text!.length;
  report.conciseReplyProxy = delivery.reply_text!.length <= 600;
  if (researchLive) {
    const research = outcome.research;
    report.research = research;
    assert.ok(research, 'Research conclusions must be included in the delivered outcome');
    assert.equal(research.review, 'model_reviewed', 'A real review must inspect the evidence');
    assert.ok(research.sources.length >= 2 && research.sources.every(source => source.toolCallId && /^[a-f0-9]{64}$/.test(source.snapshotHash)), 'Research evidence must retain actual provenance');
    const nonObservableNetworkClaim = claim => claim.support === 'uncertain'
      && /(?:没有使用互联网来源|没有访问互联网|未访问互联网|仅来自工作区|no internet|no network)/i.test(claim.statement);
    assert.ok(research.claims.every(claim => claim.sourceIds.length && (claim.support === 'supported' || nonObservableNetworkClaim(claim))), 'Substantive research claims must be supported; a network-absence assertion may remain uncertain');
    const gaps = research.checks.filter(check => check.status !== 'passed');
    assert.ok(research.checks.length > 2 && gaps.every(check => check.status === 'unverified'
      && /未访问互联网|未访问网络|未使用互联网检索|未使用外部价格来源|未使用.*互联网|no internet|no network/i.test(check.criterion)), 'Substantive criteria must pass; non-observable network absence remains unverified');
    report.acceptanceDisposition = gaps.length ? 'honest_partial_process_source_audit' : 'completed';
    if (gaps.length) assert.ok(/部分|未.*验证|未.*核验|partial|unverified/i.test(delivery.reply_text!), 'The reply must disclose the remaining verification gap');
    assert.ok(/未公开|未披露|not disclosed/i.test(downloadedReport), 'The report must preserve the undisclosed TTS price');
    assert.ok(/0\.016|0\.017|1\s*\/\s*60/.test(downloadedReport) && /0\.033|2\s*\/\s*60/.test(downloadedReport), 'Hourly prices must be converted correctly');
    assert.ok(/150/.test(delivery.reply_text!) && /210/.test(delivery.reply_text!) && /40/.test(delivery.reply_text!)
      && /未公开|未披露|not disclosed/i.test(delivery.reply_text!), 'The concise reply must retain the main numbers and the missing TTS price');
    const receipt = db.prepare('SELECT verification_json FROM task_run_receipts WHERE run_id IN (SELECT run_id FROM task_runs WHERE task_id = ?) ORDER BY finalized_at DESC LIMIT 1').get(taskId!) as { verification_json: string };
    report.criterionVerification = JSON.parse(receipt.verification_json);
    report.research = research;
    const { reviewResearchResult, applyResearchReview } = await import('../src/tasks/task-research-result.js');
    const source = research.sources.find(item => item.excerpt.includes('Vendor A ASR: 1.00'));
    assert.ok(source, 'The real review must retain the frozen pricing source');
    const negative = { ...research, instructionChecks: [], inspectedArtifactIds: [], sources: [source], claims: [{ id: 'wrong-price', kind: 'fact' as const,
      statement: 'Vendor A ASR costs 100.00 CNY per hour.', sourceIds: [source.id], support: 'unreviewed' as const }], checks: [], review: 'unavailable' as const };
    const workerConversation = (db.prepare('SELECT active_conversation_id FROM task_conversation_state WHERE task_id = ?').get(taskId!) as { active_conversation_id: string }).active_conversation_id;
    const negativeRaw = await reviewResearchResult({ conversationId: workerConversation,
      brief: 'Frozen-source benchmark: assess the Vendor A hourly price. The quote is evidence; do not invent another price.',
      criteria: ['The Vendor A hourly price follows the cited source.'], result: negative }, AbortSignal.timeout(30_000));
    const negativeResult = applyResearchReview(negative, negativeRaw, ['The Vendor A hourly price follows the cited source.']);
    report.negativeReview = negativeResult;
    assert.notEqual(negativeResult.claims[0].support, 'supported', 'A real review must reject the deliberately wrong price');
    assert.notEqual(negativeResult.checks[0].status, 'passed', 'The wrong-price criterion must not pass');
  }
  const workspace = catalog.get(allocation.selected_agent_id)!.workspace!;
  assert.ok(existsSync(join(workspace, 'report.md')), 'The analyst must create the requested report');
  const analysis = readFileSync(join(workspace, 'report.md'), 'utf8');
  assert.ok(analysis.includes('150') && analysis.includes('210') && analysis.includes('40'), 'The actual report must contain verified totals and growth');
  assert.ok(existsSync(join(workspace, 'reproduce.mjs')), 'The reproducible script must exist');
  const routerCalls = db.prepare("SELECT COUNT(*) AS count FROM ai_usage_events WHERE operation = 'task.allocation' AND status = 'succeeded'").get() as { count: number };
  assert.ok(routerCalls.count > 0, 'The real Task Router model must choose the executor; deterministic or user-selected bypass does not qualify');
  const mainToolResults = db.prepare(`SELECT e.payload_json FROM transcript_entries e JOIN transcripts t ON t.transcript_id = e.transcript_id
    WHERE t.conversation_id = ? AND e.role = 'toolResult' ORDER BY e.seq`).all(personal.conversation_id)
    .map(row => JSON.parse((row as { payload_json: string }).payload_json) as { toolName: string; isError?: boolean });
  const mainPaths = new Map<string, string>();
  for (const row of db.prepare("SELECT e.payload_json FROM transcript_entries e JOIN transcripts t ON t.transcript_id=e.transcript_id WHERE t.conversation_id=? AND e.role='assistant'").all(personal.conversation_id)) {
    for (const part of JSON.parse((row as { payload_json: string }).payload_json).content ?? []) if (part.type === 'toolCall' && part.name === 'read_file') mainPaths.set(part.id, part.arguments?.path ?? '');
  }
  report.mainInputPreRead = mainToolResults.filter(result => result.toolName === 'read_file').length;
  report.mainStrategy = report.mainInputPreRead ? 'read_related_csv_then_delegate' : 'delegate_directly';
  assert.ok(mainToolResults.length >= 1 && mainToolResults.every(result => result.toolName === 'personal_task'
    || result.toolName === 'read_file' && /(?:^|[/\\])sales\.csv$/.test(mainPaths.get((result as { toolCallId: string }).toolCallId) ?? '')), 'Main must delegate execution and may only inspect the requested related CSV; no unrelated tools or external actions');
  assert.ok(!mainToolResults.some(result => result.isError), 'Main transcript must not contain tool argument or execution errors');
  report.mainToolResults = mainToolResults.map(({ toolName, isError }) => ({ toolName, isError: Boolean(isError) }));
  const workerToolErrors = (db.prepare(`SELECT COUNT(*) AS count FROM transcript_entries e JOIN transcripts t ON t.transcript_id = e.transcript_id
    WHERE t.conversation_id != ? AND e.role = 'toolResult' AND json_extract(e.payload_json, '$.isError') = 1`).get(personal.conversation_id) as { count: number }).count;
  report.workerToolErrors = workerToolErrors;
  if (!researchLive) assert.equal(workerToolErrors, 0, 'Stable specialist execution must not recover from tool errors');
  const callCommands = new Map<string, string>();
  for (const row of db.prepare("SELECT payload_json FROM transcript_entries WHERE role = 'assistant'").all()) {
    for (const part of JSON.parse((row as { payload_json: string }).payload_json).content ?? []) {
      if (part.type === 'toolCall' && part.name === 'exec_command') callCommands.set(part.id, part.arguments?.command ?? part.arguments?.cmd ?? '');
    }
  }
  const scriptExecutions = db.prepare(`SELECT e.payload_json FROM transcript_entries e WHERE e.role = 'toolResult'
    AND json_extract(e.payload_json, '$.toolName') = 'exec_command' AND json_extract(e.payload_json, '$.details.status') = 'success'`).all()
    .map(row => JSON.parse((row as { payload_json: string }).payload_json) as { toolCallId: string; details?: { command?: string } })
    .filter(result => /\bnode\s+(?:['"]?[^\s'"`]*[/\\])?reproduce\.mjs/.test(result.details?.command ?? callCommands.get(result.toolCallId) ?? ''));
  assert.ok(scriptExecutions.length > 0, 'The reproducible script must be executed successfully through the worker command tool');
  report.successfulScriptExecutions = scriptExecutions.length;
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM tasks').get() as { count: number }).count, 1, 'Submission must create exactly one Task');
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM task_runs WHERE task_id = ?').get(taskId!) as { count: number }).count, 1, 'Allocation must queue exactly one executor');
  assert.equal(allocation.attempts, 1, 'A stable allocation must not require retry');
  assert.equal(toolCalls.filter(call => call.name === 'personal_task' && call.command === 'submit').length, 1, 'The main Agent must submit once without tool retries');
  assert.ok(!toolCalls.some(call => call.failed), 'Main tools must not fail or require recovery');
  assert.ok(!toolCalls.some(call => ['match', 'agents'].includes(call.command ?? '')), 'The main Agent must not poll or perform executor discovery');
  assert.ok(timings.submitToolMs <= 250, 'Submit persistence exceeded the 250ms smoke budget');
  assert.ok(timings.taskPersisted - timings.requestSent <= 20_000, 'Main Task briefing exceeded the 20s smoke budget');
  assert.ok(timings.assigned - timings.taskPersisted <= (researchLive ? 45_000 : 15_000), 'Allocation exceeded the smoke budget');
  assert.ok(timings.personalInitialCompleted - timings.submitToolReturned <= 5_000, 'Main submission acknowledgement exceeded the 5s smoke budget');
  assert.ok(timings.pingCompleted - timings.pingSent <= 5_000, 'Main conversation response exceeded the 5s smoke budget');
  if (fileLoss) { assert.ok(fileInjected, 'File-loss injection must happen');
    const repairEvents = db.prepare("SELECT payload_json FROM task_run_events WHERE run_id IN (SELECT run_id FROM task_runs WHERE task_id = ?) AND type = 'task_run.continuation_scheduled'").all(taskId!);
    report.repairEvents = repairEvents;
    const deletedId = injections.find(event => event.kind === 'published_file_deleted')!.artifactId;
    const restored = outcome.deliverables.find(item => item.title === 'report.md' && item.availability === 'available' && item.artifactId !== deletedId);
    assert.ok(restored, 'The deleted publication must be replaced by a downloadable final artifact on the same TaskRun');
    report.repairDisposition = repairEvents.length ? 'coordinator_continuation' : 'within_turn_republication';
    report.restoredArtifactId = restored.artifactId; }
  if (directionChange) { assert.ok(directionInjected, 'User change must arrive during execution');
    const changed = publishedContents.get('change_notes.md') ?? '';
    assert.ok(changed.includes(`REVISED-${marker}`) && /4|四/.test(changed) && changed.includes('2026-01') && changed.includes('2026-02'), 'The revised file and required content must be downloaded from the original main Chat');
    assert.ok(outcome.research.instructionChecks?.length && outcome.research.instructionChecks.every(check => check.status === 'passed'), 'Every latest instruction needs adoption evidence'); }
  if (activeWeb) {
    const liveSource = outcome.research.sources.find(source => source.toolName === 'web_fetch' && source.url?.startsWith('https://developer.mozilla.org/'));
    assert.ok(liveSource, 'Real web fetch evidence must be retained, not fixture knowledge');
    assert.ok(liveSource.observedAt >= timings.requestSent, 'Source must be retrieved during this actual trial');
    assert.ok(/404/.test(downloadedReport) && /(?:不能|无法|不(?:代表|表示|说明|足以))[。\n]{0,2}[^。\n]{0,70}永久|not[^.\n]{0,100}permanent|temporary or permanent/i.test(downloadedReport), 'Report must retain the limit that 404 alone does not prove permanent deletion');
  }
  if (conflict) {
    assert.ok(/冲突|不可靠|错误|contradic|conflict|incorrect/i.test(downloadedReport), 'The report must explain the conflicting secondary claim');
    assert.ok(outcome.research.sources.some(source => source.excerpt.includes('HTTP 404 means successful delivery')), 'The conflicting source must be read and retained alongside the live source');
  }
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
  const usage = db.prepare(`SELECT operation,provider,model,status,started_at,finished_at,duration_ms,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,reasoning_tokens,error_summary
    FROM ai_usage_events ORDER BY started_at`).all();
  const inputs = db.prepare('SELECT client_message_id,status,created_at_ms,updated_at_ms,error FROM session_inputs ORDER BY created_at_ms').all();
  const contract = taskId ? db.prepare('SELECT acceptance_criteria_json FROM task_contracts WHERE task_id = ? ORDER BY version DESC LIMIT 1').get(taskId) as { acceptance_criteria_json: string } : undefined;
  const logDirectory = join(directory, 'logs');
  const fallbackEvents = existsSync(logDirectory) ? readdirSync(logDirectory).filter(name => /^app-.*\.log$/.test(name))
    .flatMap(name => readFileSync(join(logDirectory, name), 'utf8').split('\n')).flatMap(line => {
      try { const event = JSON.parse(line); return event.module === 'PersonalReplyComposer'
        && event.msg === 'Reply composition failed; delivering the recorded result'
        ? [{ reason: event.err?.message, conversationId: event.conversationId, taskRunId: event.taskRunId }] : []; }
      catch { return []; }
    }) : [];
  report = { ...report, success: !failure, failure, marker, task,
    acceptanceCriteria: contract ? JSON.parse(contract.acceptance_criteria_json) : undefined,
    compositionFallbackEvents: fallbackEvents,
    repairEvents: taskId ? db.prepare("SELECT type,payload_json,occurred_at FROM task_run_events WHERE run_id IN (SELECT run_id FROM task_runs WHERE task_id = ?) AND type = 'task_run.continuation_scheduled'").all(taskId) : [],
    injections, scenario,
    benchmark: { suite: 'personal-delivery-live-repair', version: 6, mode: 'real-model-isolated-gateway',
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      nodeVersion: process.version, fixtureSha256: createHash('sha256').update(fixtureContent + (researchLive ? priceFixture : '')).digest('hex'),
      sourceHashes: initialSourceHashes,
      sourceChangedDuringRun: JSON.stringify(initialSourceHashes) !== JSON.stringify(sourceFingerprint()),
      limitation: 'Synthetic sales/prices plus actual MDN retrieval; file deletion is a disclosed isolated fault injection. Length proxy is not naturalness. Every failed round is retained.' },
    models: { personal: selection.model_override, global: JSON.parse(settings.defaults_json).models.chat.primary },
    timeline, rawTimings: timings, toolCalls, usage, inputs, isolatedStateDirectory: directory };
  mkdirSync(join(reportPath, '..'), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ reportPath, success: !failure }));
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  await service.stop();
  closeXopcDatabase();
  // The credential directory is shared; never delete it during isolated-state cleanup.
  rmSync(configPath, { force: true });
}
// Standalone smoke runners must not retain SDK/socket/worker handles after Gateway shutdown.
process.exit(process.exitCode ?? 0);
