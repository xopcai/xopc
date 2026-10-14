/** Opt-in real-model Gateway verification using current model configuration and isolated synthetic data. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { serve } from '@hono/node-server';

assert.equal(process.env.XOPC_CONNECTED_COLLABORATION_LIVE, '1', 'This script requires explicit authorization for real model usage');
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
const directory = mkdtempSync(join(tmpdir(), 'xopc-personal-connected-live-'));
const token = randomUUID();
const reportPath = resolve(process.env.XOPC_CONNECTED_COLLABORATION_REPORT ?? 'docs/design/technical/personal-connected-collaboration-live-2026-10-14.json');
const config = JSON.parse(readFileSync(sourceConfigPath, 'utf8'));
config.gateway = { ...config.gateway, auth: { mode: 'token', token }, tailscale: { mode: 'off' } };
if (config.tunnel) config.tunnel.enabled = false;
for (const channel of Object.values(config.channels ?? {}) as Array<Record<string, unknown>>) channel.enabled = false;
if (config.heartbeat) config.heartbeat.enabled = false;
config.userContext = { ...config.userContext, enabled: false };
config.connectors = { instances: { 'composio-gmail': { xopcConnector: { managed: true, connectorId: 'composio-gmail', enabled: true }, runtime: { type: 'composio', role: 'toolkit', toolkit: 'gmail' } } } };
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
createConversation({ agentId: personal.agent_id, sourceChannel: 'webchat', name: 'Live connected collaboration verification',
  hiddenFromSessionList: true, customData: { personalAgent: true, keepHiddenFromSessionList: true } }, directory, personal.conversation_id);
setSessionConfig(personal.conversation_id, { modelOverride: selection.model_override, fixedModel: true,
  thinkingLevel: selection.thinking_level as 'off' }, directory);

const workerHandles = new Map<string, ReturnType<InstanceType<typeof AgentToolsFactory>['createAllTools']>>();
const workerTools = new Map<string, string[]>();
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
  if (args[0]?.conversationId && args[0]?.agentId !== personal.agent_id) {
    workerTools.set(args[0].conversationId, tools.map(tool => tool.name)); workerHandles.set(args[0].conversationId, tools);
  }
  const isMain = args[0]?.conversationId === personal.conversation_id || args[0]?.agentId === personal.agent_id;
  for (const tool of tools) if (isMain || ['task_collaboration', 'personal_request_result', 'personal_request_connection', 'xopc_tool_execute'].includes(tool.name)) {
    const execute = tool.execute;
    tool.execute = async function (...callArgs) {
      const command = (callArgs[1] as { command?: string }).command;
      const isSubmit = tool.name === 'personal_request' && command === 'submit';
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


const { upsertConnectorInstallation, upsertConnectorConnection, upsertConnectorActionMetadata } = await import('../src/storage/sqlite/connector-repository.js');
const { ComposioSessionsAdapter } = await import('../src/connectors/composio-sessions.js');
const { getActiveConnectionWait } = await import('../src/storage/sqlite/connection-wait-repository.js');
const { ComposioToolProvider } = await import('../src/agent/external-tools/composio-provider.js');
const { TaskCollaborationRepository } = await import('../src/tasks/task-collaboration-repository.js');
const { TaskRunRepository } = await import('../src/tasks/task-run-repository.js');
const { getPersonalRequest } = await import('../src/personal-agent/request-repository.js');
const { PERSONAL_REQUEST_TOOL_IDS } = await import('../src/agent/embedded/execution-tool-policy.js');
const installation = upsertConnectorInstallation({ id: 'composio-gmail-local-owner', connectorId: 'composio-gmail',
  principalId: 'local-owner', enabled: true, allowedAgentIds: [], maxScope: 'write', confirmationPolicy: 'writes', selectedAccountIds: null });
const account = upsertConnectorConnection({ id: 'fixture-work-account', connectorId: 'composio-gmail', provider: 'composio',
  principalId: 'local-owner', providerConnectionId: 'fixture-work-account', status: 'active', identity: { email: 'work@example.test' }, isDefault: true, metadata: {} });
const alternate = upsertConnectorConnection({ id: 'fixture-other-account', connectorId: 'composio-gmail', provider: 'composio',
  principalId: 'local-owner', providerConnectionId: 'fixture-other-account', status: 'active', identity: { email: 'other@example.test' }, isDefault: false, metadata: {} });
const eligible = ['researcher', 'writer'].filter(id => catalog.get(id)?.enabled);
assert.equal(eligible.length, 2, 'Fixture needs two current eligible agents for real model routing');
db.prepare('UPDATE connector_accounts SET allowed_agent_ids_json = ? WHERE id = ?').run(JSON.stringify([personal.agent_id, ...eligible]), account.accountId);
upsertConnectorActionMetadata({ connectorId: 'composio-gmail', actionId: 'GMAIL_FETCH_EMAILS', scope: 'read', curated: true, cachedAt: new Date().toISOString() });
upsertConnectorActionMetadata({ connectorId: 'composio-gmail', actionId: 'GMAIL_SEND_EMAIL', scope: 'write', curated: true, cachedAt: new Date().toISOString() });
const range = { from: '2026-10-01T00:00:00+08:00', to: '2026-10-08T00:00:00+08:00', timezone: 'Asia/Shanghai', expression: '2026-10-01 through 2026-10-07' };
const fixtureMessages = [
  { messageId: 'urgent-001', subject: 'Urgent: deadline Friday', sender: 'team@example.test', receivedAt: '2026-10-07T09:00:00Z', importanceReason: 'Urgent deadline needs a reply', openUrl: 'https://mail.google.com/mail/u/0/#inbox/urgent-001' },
  { messageId: 'routine-002', subject: 'Weekly newsletter', sender: 'news@example.test', receivedAt: '2026-10-06T09:00:00Z', importanceReason: 'Routine newsletter', openUrl: 'https://mail.google.com/mail/u/0/#inbox/routine-002' },
];
const providerCalls: Array<Record<string, unknown>> = [];
const marker = `LIVE-CONNECTED-${randomUUID().slice(0, 8)}`;
const service = new GatewayService({ configPath, enableHotReload: false, listenPort: 0 });
let server: ReturnType<typeof serve> | undefined;
let fixtureServer: ReturnType<typeof serve> | undefined;
let report: Record<string, unknown> = {};
let failure: string | undefined;
let taskId: string | undefined;
let requestId: string | undefined;
try {
  fixtureServer = serve({ hostname: '127.0.0.1', port: 0, fetch: async request => {
    const input = await request.json() as { xopcAccountId: string; stage: string; query: string };
    assert.equal(input.xopcAccountId, account.accountId, 'App fixture must receive only the bound account');
    providerCalls.push({ ...input, at: Date.now() });
    if (input.stage === 'initial') {
      mark('initialReadStarted');
      await new Promise(resolve => setTimeout(resolve, 20_000));
    }
    if (input.stage === 'initial' && process.env.XOPC_CONNECTED_REAUTHORIZE === '1') {
      upsertConnectorConnection({ ...account, status: 'expired' }); mark('accountExpired');
    }
    if (input.stage === 'final') assert.match(input.query, /urgent|紧急/i, 'Supplemental urgent filter must reach the app read');
    return Response.json({ account: 'work@example.test', items: input.stage === 'final' ? [fixtureMessages[0]] : fixtureMessages,
      coverage: { from: range.from, to: range.to, scannedCount: 2, partial: false }, verificationCode: 735,
      instruction: input.stage === 'initial' ? 'Initial scan complete. Read and acknowledge any supplemental Task instructions before the final filtered scan.' : 'Verified final filtered scan complete. Publish its current result with personal_request_result.' });
  } });
  if (!fixtureServer.listening) await once(fixtureServer, 'listening');
  const fixtureUrl = `http://127.0.0.1:${(fixtureServer.address() as { port: number }).port}/read`;
  // Only the external application's I/O is synthetic. Tool schemas, revisions, account/read policies and all models stay real.
  const toolRef = 'composio:composio-gmail-local-owner:GMAIL_FETCH_EMAILS';
  const descriptor = { toolRef, source: 'composio' as const, namespace: installation.id, title: 'GMAIL_FETCH_EMAILS',
    summary: 'Read Gmail emails, urgent mail and query coverage. 读取邮件，重要及紧急邮件。',
    description: 'Isolated read-only Gmail fixture. Always use the selected xopcAccountId. First run stage initial; after supplemental directions use stage final with query urgent. Initial scan takes 20 seconds. No writes are supported.',
    readOnly: true, batchRead: false, contractRevision: 'connected-collaboration-fixture-v1', inputSchema: { type: 'object', additionalProperties: false,
      properties: { xopcAccountId: { type: 'string' }, stage: { type: 'string', enum: ['initial', 'final'] }, query: { type: 'string' } },
      required: ['xopcAccountId', 'stage', 'query'] } };
  ComposioToolProvider.prototype.search = async function () { return [descriptor]; };
  ComposioToolProvider.prototype.describe = async function (ref) { return ref === toolRef ? descriptor : undefined; };
  ComposioToolProvider.prototype.execute = async function (ref, args, _approval, context) {
    assert.equal(ref, toolRef);
    const response = await fetch(fixtureUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args), signal: context.signal });
    if (!response.ok) throw new Error('Fixture read failed');
    return { content: [{ type: 'text', text: JSON.stringify(await response.json()) }], details: { status: 'success' } };
  };
  let authGranted = false;
  ComposioSessionsAdapter.prototype.authorize = async function () {
    mark('authorizationStarted');
    return { connectionId: account.providerConnectionId, connectUrl: 'https://example.test/fixture-oauth' };
  };
  ComposioSessionsAdapter.prototype.syncConnections = async function () {
    const selected = upsertConnectorConnection({ ...account, status: authGranted ? 'active' : 'expired' });
    return [selected, alternate];
  };
  ComposioSessionsAdapter.prototype.createSession = async function () {
    return { search: async () => ({ toolSchemas: { GMAIL_FETCH_EMAILS: { inputSchema: descriptor.inputSchema } } }) } as Awaited<ReturnType<InstanceType<typeof ComposioSessionsAdapter>['createSession']>>;
  };
  await service.start();
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
  const completed = (suffix: string) => (db.prepare('SELECT status FROM session_inputs WHERE client_message_id = ?')
    .get(`${marker}-${suffix}`) as { status: string } | undefined)?.status === 'completed';
  const board = new TaskCollaborationRepository();
  baseline = Date.now(); mark('requestSent');
  await append('task', `请通过连接应用请求完成隔离 Gmail 协作验证 ${marker}，使用账户 work@example.test（账户ID ${account.accountId}），读取2026-10-01至2026-10-07的重要邮件，时区Asia/Shanghai。仅授权读取这个账户，不发送、不归档、不删邮件，不换账户。这是隔离合成数据验证，不会读取真实邮箱。执行者必须按步骤：先使用 task_collaboration 提问“请确认查询范围？”并停下，主对话可根据本请求回答；恢复后再提问“请提供报告标签？”并停下，标签未提供，不要自行选择。标签回答后正式ack，再用外部工具读取 stage initial（此读取需20秒，供我补充要求）；随后读协作记录、确认并落实补充要求，用 stage final 做最终读取并将最新摘要、来源项和完整coverage通过personal_request_result返回主对话。最终回复包含报告标签、标题、实际筛选结果和校验码。保持同一个Request、Task及执行者，提交后主对话不要等待后台。`);
  mark('requestAccepted');
  let pingSent = false, readSent = false, answerSent = false, instructionSent = false;
  let securityChecked = false;
  let reauthorized = false;
  let lastState = '';
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    const row = db.prepare('SELECT request_id,task_id FROM personal_requests ORDER BY created_at LIMIT 1').get() as { request_id: string; task_id: string | null } | undefined;
    if (row?.task_id) {
      requestId = row.request_id; taskId = row.task_id;
      const run = new TaskRunRepository().getLatestRoot(taskId);
      const allocation = db.prepare('SELECT status,updated_at FROM task_allocations WHERE task_id = ?').get(taskId) as { status: string; updated_at: number };
      if (allocation.status === 'assigned') mark('assigned', allocation.updated_at);
      if (run?.startedAt) mark('runStarted', run.startedAt);
      if (run?.completedAt) mark('runCompleted', run.completedAt);
      if (completed('task')) mark('personalInitialCompleted');
      const entries = board.list(taskId, 0, 100);
      const question = entries.find(entry => entry.kind === 'question' && /范围|range/i.test(entry.body));
      const answer = entries.find(entry => entry.kind === 'answer' && entry.causationId === question?.id);
      const labelQuestion = entries.find(entry => entry.kind === 'question' && /标签|label/i.test(entry.body));
      const labelAnswer = entries.find(entry => entry.kind === 'answer' && entry.causationId === labelQuestion?.id);
      const instruction = entries.find(entry => entry.kind === 'instruction' && /735|待办简报/.test(entry.body));
      if (question) mark('knownQuestion', question.createdAt);
      if (answer) mark('knownAnswer', answer.createdAt);
      if (answer?.deliveryStatus === 'confirmed') mark('knownConfirmed');
      if (labelAnswer) mark('labelAnswer', labelAnswer.createdAt);
      if (labelAnswer && ['delivered','confirmed'].includes(labelAnswer.deliveryStatus ?? '') && run?.status === 'running') mark('labelResumed');
      if (labelAnswer?.deliveryStatus === 'confirmed') mark('labelConfirmed');
      if (instruction) mark('instructionPersisted', instruction.createdAt);
      if (instruction && ['delivered','confirmed'].includes(instruction.deliveryStatus ?? '')) mark('instructionDelivered');
      if (instruction?.deliveryStatus === 'confirmed') mark('instructionConfirmed');
      const trigger = labelQuestion ? db.prepare('SELECT status FROM session_inputs WHERE client_message_id = ?').get(`task-main-update:${labelQuestion.id}`) as { status: string } | undefined : undefined;
      if (!pingSent && trigger?.status === 'completed') {
        pingSent = true; mark('pingSent');
        await append('ping', `标签稍后再答。现在只回复 ${marker}-READY，不要查询任务，不要等待后台。`);
      }
      if (pingSent && completed('ping')) {
        mark('pingCompleted');
        if (!readSent) { readSent = true; mark('readSent'); await append('read', '请读取原连接应用Request完整状态，告诉我选定账户、执行者及等待的问题。不要替我回答标签，不要新建Request或Task。'); }
      }
      if (readSent && completed('read') && !answerSent) {
        answerSent = true; mark('readCompleted'); mark('userAnswerSent');
        await append('answer', '执行者刚才问的报告标签是 工作观察。请通过原Request把答案交回同一个问题，让执行者继续。');
      }
      if (timings.initialReadStarted && !instructionSent && completed('answer')) {
        if (!securityChecked && run?.conversationId) {
          const handles = workerHandles.get(run.conversationId)!;
          const execute = handles.find(tool => tool.name === 'xopc_tool_execute')!;
          const describe = handles.find(tool => tool.name === 'xopc_tool_describe')!;
          const { runWithEmbeddedExecutionSession } = await import('../src/agent/embedded/execution-context.js');
          const callsBefore = providerCalls.length;
          const probes: Record<string, string> = {};
          await runWithEmbeddedExecutionSession(run.conversationId, async () => {
            const contract = await describe.execute('probe-contract', { toolRefs: [toolRef] });
            const revision = JSON.parse((contract.content[0] as { text: string }).text).tools[0].revision;
            const denied = async (name: string, input: unknown, pattern: RegExp) => {
              await assert.rejects(() => execute.execute(`probe-${name}`, input as never), pattern); probes[name] = 'denied';
            };
            await denied('wrongAccount', { toolRef, revision, arguments: { xopcAccountId: alternate.accountId, stage: 'final', query: 'urgent' } }, /selected Personal request account/);
            await denied('write', { toolRef: 'composio:composio-gmail-local-owner:GMAIL_SEND_EMAIL', revision, arguments: { xopcAccountId: account.accountId } }, /curated read/);
            await denied('wrongConnector', { toolRef: 'composio:other-installation:GMAIL_FETCH_EMAILS', revision, arguments: { xopcAccountId: account.accountId } }, /selected Personal request connector/);
            db.prepare('UPDATE connector_accounts SET allowed_agent_ids_json = ? WHERE id = ?').run(JSON.stringify([personal.agent_id]), account.accountId);
            try { await denied('revokedExecutor', { toolRef, revision, arguments: { xopcAccountId: account.accountId, stage: 'final', query: 'urgent' } }, /authorization no longer permits/); }
            finally { db.prepare('UPDATE connector_accounts SET allowed_agent_ids_json = ? WHERE id = ?').run(JSON.stringify([personal.agent_id, ...eligible]), account.accountId); }
          });
          assert.equal(providerCalls.length, callsBefore, 'Denied probes must never reach the external app');
          report.securityProbes = probes; securityChecked = true; mark('securityChecked');
        }
        instructionSent = true; mark('instructionSent');
        await append('instruction', '补充原连接应用请求：标题改为 待办简报，只保留紧急邮件，保留标签 工作观察、原查询范围和work@example.test账户，最终摘要带校验码735。请把新要求交给原执行者并依据最终筛选结果返回，不创建新Request或Task。');
      }
      const currentRequest = getPersonalRequest(requestId)!;
      if (!reauthorized && currentRequest.state === 'waiting_connection' && currentRequest.connectionWaitId) {
        mark('waitingConnection');
        const activeInput = db.prepare("SELECT 1 FROM session_inputs WHERE task_run_id = ? AND status IN ('queued','running','injecting') LIMIT 1").get(run?.id ?? '');
        if (!activeInput) {
          const wait = getActiveConnectionWait(personal.conversation_id)!;
          const response = await api(`/api/sessions/${personal.conversation_id}/connection-wait/actions`, {
            waitId: wait.id, expectedTranscriptId: wait.transcriptId, expectedVersion: wait.version,
            expectedObjectiveRevision: wait.objectiveRevision, idempotencyKey: `${marker}-connect`, action: 'connect', needKey: wait.needs[0].key,
          });
          report.authorizationResponse = response;
          authGranted = true;
          await service.connectionRecovery.poll();
          if (getPersonalRequest(requestId)?.state === 'queued') { reauthorized = true; mark('authorizationResumed'); }
        }
      }
      const delivery = run ? db.prepare('SELECT reply_status FROM task_result_deliveries WHERE task_run_id = ?').get(run.id) as { reply_status: string } | undefined : undefined;
      if (delivery?.reply_status === 'delivered') { mark('personalResultDelivered'); break; }
      const state = `${allocation.status}/${run?.status}/${entries.map(entry => `${entry.kind}:${entry.deliveryStatus ?? '-'}`).join(',')}`;
      if (state !== lastState) { console.log(JSON.stringify({ state, elapsedMs: Date.now() - baseline })); lastState = state; }
      if (['blocked','failed'].includes(allocation.status) || run?.status === 'failed') throw new Error(`Task failed: ${state}`);
    } else if (Date.now() - baseline > 35_000) throw new Error('No connected Task persisted in 35 seconds');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (process.env.XOPC_CONNECTED_REAUTHORIZE === '1') assert.ok(timings.authorizationResumed, 'The original Request must resume after main-UI reauthorization');
  assert.ok(timings.personalResultDelivered, 'Timed out awaiting connected result');
  const request = getPersonalRequest(requestId!)!;
  const run = new TaskRunRepository().getLatestRoot(taskId!)!;
  const history = await api(`/api/sessions/${personal.conversation_id}/history?view=compact`);
  report.history = history;
  assert.ok(history.session.messages.some((message: { role: string; content: string }) => message.role === 'assistant' && message.content.includes(`${marker}-READY`)));
  assert.ok(eligible.includes(request.executorAgentId), 'Router must select an account-authorized executor');
  assert.equal(request.accountId, account.accountId);
  assert.ok(timings.knownConfirmed && timings.labelConfirmed && timings.instructionConfirmed, 'Both answers and the supplemental instruction must be formally confirmed');
  assert.ok(timings.pingCompleted < timings.runCompleted, 'Main must remain responsive before execution completes');
  assert.equal(request.result?.items.length, 1);
  assert.equal(request.result?.items[0].messageId, 'urgent-001');
  assert.ok(request.result?.summary.includes('待办简报') && request.result.summary.includes('工作观察') && request.result.summary.includes('735'));
  assert.equal(request.result?.coverage?.partial, false);
  const delivery = db.prepare('SELECT reply_text,reply_payload_json FROM task_result_deliveries WHERE task_run_id = ?').get(run.id) as { reply_text: string; reply_payload_json: string };
  assert.ok(['待办简报','工作观察','735'].every(value => delivery.reply_text.includes(value)));
  assert.ok(!delivery.reply_text.includes('Weekly newsletter'), 'Final structured items must use the updated urgent filter');
  report.compositionFallback = delivery.reply_text === JSON.parse(delivery.reply_payload_json).report;
  assert.equal(report.compositionFallback, false);
  assert.equal((db.prepare('SELECT count(*) AS count FROM personal_requests').get() as { count: number }).count, 1);
  assert.equal((db.prepare('SELECT count(*) AS count FROM tasks').get() as { count: number }).count, 1);
  assert.equal((db.prepare('SELECT count(*) AS count FROM task_runs').get() as { count: number }).count, 1);
  assert.ok((db.prepare("SELECT count(*) AS count FROM ai_usage_events WHERE operation='task.allocation' AND status='succeeded'").get() as { count: number }).count > 0);
  assert.ok(securityChecked, 'Live tool-boundary security probes must run');
  assert.ok(providerCalls.some(call => call.stage === 'initial') && providerCalls.some(call => call.stage === 'final'));
  assert.ok(providerCalls.every(call => call.xopcAccountId === account.accountId));
  assert.ok([...workerTools.values()].every(names => names.every(name => (PERSONAL_REQUEST_TOOL_IDS as readonly string[]).includes(name))));
  assert.ok([...workerTools.values()].some(names => names.includes('task_collaboration')));
  assert.ok(toolCalls.some(call => call.name === 'personal_request' && call.command === 'get'));
  assert.ok(toolCalls.some(call => call.name === 'personal_request' && call.command === 'answer') && toolCalls.some(call => call.name === 'personal_request' && call.command === 'instruct'));
  assert.ok(!toolCalls.some(call => call.name === 'personal_task' && call.command === 'submit'));
  assert.equal(toolCalls.filter(call => call.name === 'personal_request' && call.command === 'submit').length, 1);
  const errors = (db.prepare("SELECT count(*) AS count FROM transcript_entries WHERE role='toolResult' AND json_extract(payload_json,'$.isError')=1").get() as { count: number }).count;
  assert.equal(errors, 0); report.toolErrors = errors;
  assert.ok(timings.submitToolMs < 250 && timings.pingCompleted - timings.pingSent < 5000);
  report.request = request; report.resultReply = delivery.reply_text; report.receipt = new TaskRunRepository().getReceipt(run.id);
  report.durationMs = { submitTool: timings.submitToolMs, requestToTask: timings.taskPersisted - timings.requestSent,
    allocation: timings.assigned - timings.taskPersisted, knownQuestionToAnswer: timings.knownAnswer - timings.knownQuestion,
    waitingMainResponse: timings.pingCompleted - timings.pingSent, mainRead: timings.readCompleted - timings.readSent,
    userAnswerToResume: timings.labelResumed - timings.userAnswerSent,
    instructionToBoard: timings.instructionPersisted - timings.instructionSent, instructionToConfirmed: timings.instructionConfirmed - timings.instructionSent,
    ...(reauthorized ? { reauthorization: timings.authorizationResumed - timings.waitingConnection } : {}),
    resultReturn: timings.personalResultDelivered - timings.runCompleted, total: timings.personalResultDelivered - timings.requestSent };
} catch (error) {
  failure = error instanceof Error ? error.message : String(error); process.exitCode = 1;
  console.error(JSON.stringify({ failure }));
} finally {
  report = { ...report, success: !failure, failure, marker, taskId, requestId,
    fixture: 'Synthetic Gmail provider HTTP I/O; real models, Gateway, schema/revision and account/read-only guards. No real mailbox access or OAuth proof.',
    models: { personal: selection.model_override, global: JSON.parse(settings.defaults_json).models.chat.primary },
    timeline, rawTimings: timings, toolCalls, providerCalls, workerTools: [...workerTools],
    board: taskId ? new TaskCollaborationRepository().list(taskId, 0, 100) : [],
    usage: db.prepare('SELECT operation,provider,model,status,duration_ms,error_summary FROM ai_usage_events ORDER BY started_at').all(),
    inputs: db.prepare('SELECT client_message_id,status,created_at_ms,updated_at_ms,error FROM session_inputs ORDER BY created_at_ms').all(),
    isolatedStateDirectory: directory, selectedAccountId: account.accountId, alternateAccountId: alternate.accountId };
  mkdirSync(join(reportPath, '..'), { recursive: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ reportPath, success: !failure }));
  for (const listener of [server, fixtureServer]) if (listener) { listener.closeAllConnections(); await new Promise<void>(resolve => listener.close(() => resolve())); }
  await service.stop(); closeXopcDatabase(); rmSync(configPath, { force: true });
}
process.exit(process.exitCode ?? 0);
