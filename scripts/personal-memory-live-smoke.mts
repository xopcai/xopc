/** Opt-in real-model acceptance through authenticated Gateway inputs; synthetic memory only. */
import assert from 'node:assert/strict';
import { createHash, randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { serve } from '@hono/node-server';
import { RealtimeClient } from '@xopcai/realtime-client';
import { REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';
import { endpointHelloSigningPayload, type EndpointHelloPayload } from '@xopcai/endpoint-tools-protocol';

assert.equal(process.env.XOPC_MEMORY_LIVE, '1', 'Explicit real-model authorization is required');
const sourceRoot = process.env.XOPC_STATE_DIR ?? join(homedir(), '.xopc');
const sourceConfigPath = process.env.XOPC_CONFIG_PATH ?? join(sourceRoot, 'xopc.json');
const credentials = process.env.XOPC_CREDENTIALS_DIR ?? join(sourceRoot, 'credentials');
const original = new DatabaseSync(join(sourceRoot, 'xopc.db'), { readOnly: true });
const defaults = JSON.parse(String(original.prepare('SELECT defaults_json FROM agent_catalog_settings WHERE singleton_id=1').get()!.defaults_json));
const selection = original.prepare(`SELECT c.model_override,c.thinking_level FROM sessions s JOIN session_config c USING(conversation_id)
  WHERE json_extract(s.custom_data_json,'$.personalAgent')=1 LIMIT 1`).get();
original.close();
const model = process.env.XOPC_MEMORY_LIVE_MODEL ?? String(selection?.model_override ?? defaults.models.chat.primary);
const directory = mkdtempSync(join(tmpdir(), 'xopc-memory-live-'));
const configPath = join(directory, 'xopc.json');
const reportPath = resolve(process.env.XOPC_MEMORY_REPORT ?? 'reports/memory/chat-memory-live.json');
const config = JSON.parse(readFileSync(sourceConfigPath, 'utf8'));
const token = randomUUID();
config.gateway = { ...config.gateway, auth: { mode: 'token', token }, tailscale: { mode: 'off' } };
if (config.tunnel) config.tunnel.enabled = false;
for (const channel of Object.values(config.channels ?? {}) as Array<Record<string, unknown>>) channel.enabled = false;
if (config.heartbeat) config.heartbeat.enabled = false;
config.mcp = { servers: {} };
config.userContext = { enabled: true, userModel: { enabled: true, writePolicy: 'allow',
  extraction: { reviewIntervalTurns: 1000 }, maintenance: { enabled: false } },
  knowledgeMemory: { enabled: true, writePolicy: 'allow', learning: { idleFlushMs: 600000, maxDailyBatches: process.env.XOPC_MEMORY_LIVE_CASES === 'learning' ? 100 : 3 } },
  homeIntelligence: { enabled: false } };
writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
if (existsSync(join(sourceRoot, 'cache/model-catalog'))) cpSync(join(sourceRoot, 'cache/model-catalog'), join(directory, 'cache/model-catalog'), { recursive: true });
if (existsSync(join(sourceRoot, 'models.json'))) cpSync(join(sourceRoot, 'models.json'), join(directory, 'models.json'));
process.env.XOPC_STATE_DIR = directory;
process.env.XOPC_CONFIG_PATH = configPath;
process.env.XOPC_CONFIG = configPath;
// Share the credential store and its locks; never clone OAuth refresh tokens.
process.env.XOPC_CREDENTIALS_DIR = credentials;
process.env.XOPC_WORKSPACE = join(directory, 'workspace');
process.env.XOPC_LOG_DIR = join(directory, 'logs');
process.env.XOPC_LOG_LEVEL = 'warn';
const { openXopcDatabase, closeXopcDatabase, getSqliteDatabase, setSessionConfig } = await import('../src/storage/sqlite/index.js');
const { resolveModel } = await import('../src/providers/index.js');
const { getModelThinking } = await import('../src/providers/model-thinking.js');
const thinkingOptions = getModelThinking(resolveModel(model));
const thinkingLevel = thinkingOptions.options.includes('off') ? 'off' : thinkingOptions.initialValue;
const { AgentDefaultsSchema } = await import('../src/agent-config/index.js');
const { AgentCatalogRepository } = await import('../src/agent-catalog/repository.js');
const { createConversation } = await import('../src/storage/sqlite/conversation-repository.js');
const { personalAgentId, personalConversationId } = await import('../src/personal-agent/repository.js');
const { personalInstructions } = await import('../src/personal-agent/prompts.js');
const { GatewayService } = await import('../src/gateway/service.js');
const { createHonoApp } = await import('../src/gateway/hono/app.js');
const { buildExecutionContext } = await import('../src/agent/context/execution-context.js');
const { getUserAssertion } = await import('../src/user-model/index.js');
const { getKnowledgeItem } = await import('../src/knowledge-memory/index.js');
openXopcDatabase({ path: join(directory, 'xopc.db') });
let db = getSqliteDatabase();
const agentId = personalAgentId('local-owner');
const primary = personalConversationId('local-owner');
const workspace = join(directory, 'workspace'); mkdirSync(workspace, { recursive: true });
const catalog = new AgentCatalogRepository();
catalog.ensureInitialized(AgentDefaultsSchema.parse({ runtime: { thinkingLevel }, models: { ...defaults.models, chat: { primary: model, fallbacks: [] },
  intents: { ...defaults.models.intents, understanding: { primary: model, fallbacks: [] } } } }));
for (const id of [agentId, 'memory-observer']) {
  catalog.create({ id, enabled: true, workspace, profile: id === agentId ? { name: 'Memory acceptance', instructions: personalInstructions() } : { name: 'Isolated observer' } }, { ready: true });
  catalog.markProvisioned(id);
}
function session(id: string = randomUUID(), options: { agent?: string; projectId?: string; cwd?: string; temporary?: boolean } = {}) {
  const agent = options.agent ?? agentId;
  createConversation({ agentId: agent, sourceChannel: 'webchat', name: 'Synthetic memory acceptance',
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(agent === agentId ? { customData: { personalAgent: true } } : {}) }, options.cwd ?? workspace, id);
  setSessionConfig(id, { modelOverride: model, fixedModel: true, thinkingLevel, workingDirectoryOverride: options.cwd ?? workspace,
    ...(options.temporary ? { userContextMode: 'temporary' as const } : {}) }, options.cwd ?? workspace);
  return id;
}
session(primary);
let service: InstanceType<typeof GatewayService>;
let server: ReturnType<typeof serve> | undefined;
let base = '';
let realtime: RealtimeClient | undefined;
let endpointOrigin: { type: 'endpoint'; endpointId: string; token: string } | undefined;
const report: Record<string, any> = { startedAt: new Date().toISOString(), model, realModel: true, authenticatedGateway: true,
  isolatedStateDirectory: directory, syntheticOnly: true, cases: [], errors: [], success: false,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceHashes: Object.fromEntries(['src/agent/tools/personal-memory-tool.ts', 'src/personal-agent/prompts.ts',
    'src/agent/tools/user-context-tool.ts', 'src/agent/tools/knowledge-memory-tool.ts',
    'src/agent/service/process-direct-streaming.ts', 'src/agent/service.ts', 'scripts/personal-memory-live-smoke.mts', 'scripts/memory-recall-live-cases.mts', 'scripts/memory-learning-live-cases.mts',
    'evals/memory/learning-cases.json', 'src/user-model/capture/semantic.ts', 'src/user-model/capture/evidence-policy.ts', 'src/agent/background-review/run-background-review.ts', 'src/user-model/capture/executor.ts',
    'src/agent/background-review/prompts.ts', 'src/memory-learning/work-capture.ts',
    'evals/memory/recall-cases.json', 'src/agent/tools/session-search-tool.ts', 'src/session/history-recall-policy.ts', 'src/agent/tools/factory.ts',
    'src/agent/context/deep-recall.ts', 'src/agent/context/recall-grounding.ts', 'src/agent/embedded/run-turn.ts', 'src/agent/context/coordinator.ts',
    'src/agent/context/memory-claim-grounding.ts',
    'src/agent/context/execution-context.ts', 'src/agent/context/audit.ts', 'src/user-context/config.ts', 'src/config/schema.ts', 'src/agent/agent-manager.ts'].map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])) };
const persist = () => { mkdirSync(dirname(reportPath), { recursive: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n'); };
async function start() {
  service = new GatewayService({ configPath, enableHotReload: false, listenPort: 0 }); await service.start();
  db = getSqliteDatabase();
  const app = createHonoApp({ service }); server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  server.on('upgrade', (request, socket, head) => { if (!service.realtime.handleUpgrade(request, socket, head)) socket.destroy(); });
  if (!server.listening) await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const identity = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const principalId = randomUUID(), endpointId = randomUUID(), clientId = randomUUID();
  const displayName = 'Synthetic memory browser';
  await api('/api/endpoint-tools/principals', { principalId, displayName, kind: 'web', platform: 'web',
    publicKey: identity.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url') });
  await new Promise<void>((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('Browser endpoint handshake timed out')), 20000);
    realtime = new RealtimeClient({ clientId, clientKind: 'web',
      getWebSocketUrl: () => base.replace(/^http/, 'ws') + '/api/realtime/v1/ws',
      issueTicket: async () => (await api('/api/realtime/tickets', { clientId, clientKind: 'web', protocolVersion: REALTIME_PROTOCOL_VERSION })).payload,
      createWebSocket: url => new WebSocket(url),
      onStateChange: (state, error) => { if (state === 'error') { clearTimeout(timeout); reject(new Error(error)); } },
    });
    realtime.setEndpoint({ createHello: async () => {
      const hello: EndpointHelloPayload = { principalId, endpointId, connectionInstanceId: randomUUID(), displayName,
        kind: 'web', platform: 'web', appVersion: '1', availability: 'foreground', nonce: randomUUID(), signedAt: Date.now(), signature: 'pending', tools: [] };
      hello.signature = sign('sha256', Buffer.from(endpointHelloSigningPayload(hello)), { key: identity.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      return hello;
    }, onReady: value => { endpointOrigin = { type: 'endpoint', endpointId: value.endpointId, token: value.turnToken }; clearTimeout(timeout); resolveReady(); }, onMessage: () => {} });
    realtime.connect();
  });
}
async function stop() {
  realtime?.disconnect(); realtime = undefined; endpointOrigin = undefined;
  if (server) { if ('closeAllConnections' in server) server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; }
  await service?.stop();
}
async function api(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<any> {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const payload = await response.json(); assert.ok(response.ok, `Gateway ${response.status}: ${JSON.stringify(payload)}`); return payload;
}
async function turn(name: string, content: string, conversationId = primary, cli = false) {
  const started = Date.now();
  const metadata = db.prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id=?').get(conversationId)!;
  const before = Number(db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM transcript_entries WHERE transcript_id=?').get(metadata.active_transcript_id)!.n);
  const version = db.prepare('SELECT updated_at FROM session_config WHERE conversation_id=?').get(conversationId)!;
  const clientMessageId = randomUUID();
  await api(`/api/sessions/${conversationId}/inputs`, { kind: 'append', clientMessageId, expectedTranscriptId: metadata.active_transcript_id,
    configVersion: version.updated_at, delivery: 'next', input: { content }, origin: cli ? { type: 'system', source: 'cli' } : endpointOrigin });
  const deadline = Date.now() + 150000;
  let state: Record<string, any> | undefined;
  while (Date.now() < deadline) {
    state = db.prepare('SELECT status,error,run_id FROM session_inputs WHERE conversation_id=? AND client_message_id=?').get(conversationId, clientMessageId);
    if (state && ['completed', 'failed', 'cancelled'].includes(state.status)) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  const rows = db.prepare('SELECT role,payload_json FROM transcript_entries WHERE transcript_id=? AND seq>? ORDER BY seq').all(metadata.active_transcript_id, before)
    .map(row => ({ role: row.role, payload: JSON.parse(String(row.payload_json)) }));
  const tools = rows.filter(row => row.role === 'toolResult').map(row => ({ name: row.payload.toolName, isError: row.payload.isError,
    details: row.payload.details, content: row.payload.content }));
  const assistantTexts = rows.filter(row => row.role === 'assistant').map(row => typeof row.payload.content === 'string' ? row.payload.content
    : (row.payload.content ?? []).filter((part: any) => part.type === 'text').map((part: any) => part.text).join('')).filter(text => text.trim());
  const reply = assistantTexts.at(-1) ?? '';
  const calls = rows.filter(row => row.role === 'assistant').flatMap(row => Array.isArray(row.payload.content)
    ? row.payload.content.filter((part: any) => part.type === 'toolCall').map((part: any) => ({ name: part.name, arguments: part.arguments })) : []);
  const contextAudit = db.prepare('SELECT metrics_json FROM execution_context_runs WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1').get(conversationId);
  const entry = { assistantTexts, contextMetrics: contextAudit ? JSON.parse(String(contextAudit.metrics_json)) : undefined, name, conversationId, prompt: content, reply, tools, calls, state, durationMs: Date.now() - started, passed: false };
  report.cases.push(entry); persist(); console.log(JSON.stringify({ name, state: state?.status, reply, tools: tools.map(tool => ({ name: tool.name, status: tool.details?.status, error: tool.details?.error })), durationMs: entry.durationMs }));
  assert.equal(state?.status, 'completed', `${name}: input failed: ${state?.error ?? 'no terminal result'}`);
  assert.equal(rows.filter(row => row.role === 'user').length, 1, `${name}: duplicate user transcript write`);
  const rawPayloads = rows.map(row => JSON.stringify(row));
  assert.equal(new Set(rawPayloads).size, rawPayloads.length, `${name}: duplicate transcript payload`);
  assert.ok(reply.trim() && reply.trim() !== 'NO_REPLY', `${name}: no visible reply to a direct user question`);
  assert.equal(state?.status, 'completed', `${name}: ${state?.error ?? 'turn timed out'}`);
  return entry;
}
function receipt(entry: Awaited<ReturnType<typeof turn>>, command: string, target?: string) {
  const result = entry.tools.findLast(tool => tool.name === 'personal_memory' && tool.details?.command === command && (!target || tool.details.target === target))?.details;
  assert.ok(result?.receiptId, `${entry.name}: no committed ${command} receipt`); return result;
}
function passed(entry: Awaited<ReturnType<typeof turn>>) { entry.passed = true; persist(); }
const tag = randomUUID().slice(0, 8);
const oldValue = `竹青-${tag}`, newValue = `松白-${tag}`;
try {
  await start(); await api('/api/personal-agent');
  if (process.env.XOPC_MEMORY_LIVE_CASES === 'learning') {
    const { runLearningAcceptance } = await import('./memory-learning-live-cases.mts');
    await runLearningAcceptance({ turn, session, api, db, directory, agentId, workspace, passed, saveReport: persist, report, tag } as any);
  } else if (process.env.XOPC_MEMORY_LIVE_CASES === 'recall') {
    const { runRecallAcceptance } = await import('./memory-recall-live-cases.mts');
    await runRecallAcceptance({ turn, session, api, service, db, directory, agentId, workspace, passed, report, tag });
  } else {
  const saved = await turn('remember-user', `请长期记住：我偏好的工作日报结尾标记是“${oldValue}”，用于所有协作。`);
  const saveReceipt = receipt(saved, 'remember', 'user'); assert.equal(saveReceipt.status, 'saved');
  assert.equal(saveReceipt.usable, true); assert.ok(getUserAssertion(saveReceipt.id)?.statement.includes(oldValue)); passed(saved);
  const corrected = await turn('correct-user', `纠正刚才的日报偏好：结尾标记改成“${newValue}”。旧标记不再使用，仍适用于所有协作。`);
  const correctionReceipt = receipt(corrected, 'correct', 'user'); assert.equal(correctionReceipt.status, 'saved');
  assert.ok(getUserAssertion(correctionReceipt.id)?.statement.includes(newValue)); passed(corrected);
  const fresh = session();
  const recalled = await turn('fresh-recall-corrected', '我偏好的工作日报结尾标记是什么？仅按已经保存的信息回答，不要猜。', fresh);
  assert.ok(recalled.reply.includes(newValue));
  if (recalled.reply.includes(oldValue)) assert.match(recalled.reply, /(?:不再|停用|作废|废弃|弃用)/u);
  passed(recalled);
  const narrowed = await turn('scope-agent', '把刚才那条日报偏好修改为仅当前助手适用，其他助手不要使用。');
  const narrowReceipt = receipt(narrowed, 'scope', 'user'); assert.deepEqual(narrowReceipt.scope, { type: 'agent', id: agentId }); passed(narrowed);
  const observer = session(undefined, { agent: 'memory-observer' });
  const excluded = await turn('other-agent-exclusion', '我偏好的工作日报结尾标记是什么？仅按对你生效的已保存信息回答，没有就说明不知道，不要猜。', observer);
  assert.ok(!excluded.reply.includes(newValue) && !excluded.reply.includes(oldValue)); passed(excluded);
  const widened = await turn('scope-global', '把这条日报偏好修改为全局范围，所有协作都可按需使用。');
  assert.deepEqual(receipt(widened, 'scope', 'user').scope, { type: 'global' }); passed(widened);
  const forgotten = await turn('forget-user', '请忘掉这条关于工作日报结尾标记的偏好，后续不要再从旧对话里自动找回。');
  const forgotReceipt = receipt(forgotten, 'forget', 'user'); assert.equal(forgotReceipt.status, 'forgotten');
  assert.equal(getUserAssertion(forgotReceipt.id), undefined); passed(forgotten);
  for (const [name, id] of [['same-chat-forgotten', primary], ['fresh-chat-forgotten', session()]] as const) {
    const probe = await turn(name, '我偏好的工作日报结尾标记是什么？没有可用记忆就直接说明，不要从已经要求遗忘的历史重建。', id);
    assert.ok(!probe.reply.includes(oldValue) && !probe.reply.includes(newValue), `${name}: forgotten value leaked`); passed(probe);
  }
  if (process.env.XOPC_MEMORY_LIVE_CASES !== 'basic') {
    const projectRoot = join(directory, 'project'); mkdirSync(projectRoot, { recursive: true });
    const project = service.projects.create({ name: 'Synthetic Atlas', workspaceRoot: projectRoot, executionMode: 'local_checkout' });
    await api(`/api/sessions/${primary}`, { projectId: project.id }, 'PATCH');
    const value = `验收入口-${tag}`, revisedValue = `新版入口-${tag}`;
    const projectSave = await turn('remember-project', `仅在当前项目记住：交付验收入口名称是“${value}”。其他项目和全局不使用这条事实。`);
    const projectReceipt = receipt(projectSave, 'remember', 'knowledge'); assert.deepEqual(projectReceipt.scope, { type: 'project', id: project.id }); passed(projectSave);
    const projectProbe = await turn('same-project-recall', '当前项目的交付验收入口名称是什么？仅按已有记忆回答。', session(undefined, { projectId: project.id, cwd: projectRoot }));
    assert.ok(projectProbe.reply.includes(value)); passed(projectProbe);
    const projectCorrect = await turn('correct-project', `纠正当前项目刚保存的交付验收入口：改成“${revisedValue}”，旧入口不再使用，仍仅适用于当前项目。`);
    const projectCorrectionReceipt = receipt(projectCorrect, 'correct', 'knowledge');
    assert.ok(getKnowledgeItem(projectCorrectionReceipt.id)?.content.includes(revisedValue)); passed(projectCorrect);
    const correctedProjectProbe = await turn('same-project-corrected-recall', '当前项目的交付验收入口名称是什么？仅按有效记忆回答。', session(undefined, { projectId: project.id, cwd: projectRoot }));
    assert.ok(correctedProjectProbe.reply.includes(revisedValue)); passed(correctedProjectProbe);
    const outside = await turn('outside-project-exclusion', '交付验收入口名称是什么？只使用当前范围生效的记忆，不知道就说明。', session(), true);
    assert.ok(!outside.reply.includes(value) && !outside.reply.includes(revisedValue)); passed(outside);
    const sessionValue = `会话代号-${tag}`;
    const scopedSession = session();
    const sessionSave = await turn('remember-session', `仅在当前会话记住：本次核对代号是“${sessionValue}”，不用于其他会话。`, scopedSession);
    assert.deepEqual(receipt(sessionSave, 'remember', 'knowledge').scope, { type: 'session', id: scopedSession }); passed(sessionSave);
    const sameSession = await turn('same-session-recall', '本次核对代号是什么？', scopedSession);
    assert.ok(sameSession.reply.includes(sessionValue)); passed(sameSession);
    const sessionProbe = await turn('outside-session-exclusion', '本次核对代号是什么？只按当前会话可用的记忆回答，不要猜。', session());
    assert.ok(!sessionProbe.reply.includes(sessionValue)); passed(sessionProbe);
    const workspaceValue = `工作区检查-${tag}`;
    const workspaceSave = await turn('remember-workspace', `仅在当前工作区记住：本工作区的发布检查名称是“${workspaceValue}”。`, session());
    const workspaceReceipt = receipt(workspaceSave, 'remember', 'knowledge'); assert.equal(workspaceReceipt.scope.type, 'workspace'); passed(workspaceSave);
    const sameWorkspace = await turn('same-workspace-recall', '本工作区的发布检查名称是什么？请读取有效记忆。', session());
    assert.ok(sameWorkspace.reply.includes(workspaceValue)); passed(sameWorkspace);
    const otherWorkspace = join(directory, 'other-workspace'); mkdirSync(otherWorkspace, { recursive: true });
    const workspaceProbe = await turn('other-workspace-exclusion', '本工作区的发布检查名称是什么？只按当前工作区可用的记忆回答，不知道就说明。', session(undefined, { cwd: otherWorkspace }));
    assert.ok(!workspaceProbe.reply.includes(workspaceValue)); passed(workspaceProbe);
    const noProject = await turn('missing-project-honesty', `仅在当前项目记住：缺少项目时的验证名称是“缺项-${tag}”。`, session());
    assert.ok(!noProject.tools.some(tool => tool.name === 'personal_memory' && tool.details?.status === 'saved'));
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM knowledge_items WHERE content LIKE ?').get(`%缺项-${tag}%`)!.n), 0); passed(noProject);
    const context = buildExecutionContext({ query: revisedValue, agentId, conversationId: primary, workspaceId: projectRoot, projectId: project.id });
    assert.ok(context.knowledge.some(item => item.id === projectReceipt.id));
    assert.ok(getKnowledgeItem(workspaceReceipt.id));
    report.persistenceBeforeRestart = { projectId: projectReceipt.id, workspaceId: workspaceReceipt.id };
    await stop(); await start();
    const restartProbe = await turn('restart-recall', '当前项目的交付验收入口名称是什么？请读取已保存的记忆，不要猜。', session(undefined, { projectId: project.id, cwd: projectRoot }));
    assert.ok(restartProbe.reply.includes(revisedValue)); passed(restartProbe);
    const projectForget = await turn('forget-project', '请忘记当前项目的交付验收入口名称这条知识，后续不要再从旧对话恢复。');
    const projectForgetReceipt = receipt(projectForget, 'forget', 'knowledge');
    assert.equal(projectForgetReceipt.status, 'forgotten');
    assert.equal(getKnowledgeItem(projectForgetReceipt.id), undefined); passed(projectForget);
    const forgottenProject = await turn('fresh-project-forgotten', '当前项目的交付验收入口名称是什么？没有有效记忆请说明，不要从要求忘记的旧历史重建。', session(undefined, { projectId: project.id, cwd: projectRoot }));
    assert.ok(!forgottenProject.reply.includes(value) && !forgottenProject.reply.includes(revisedValue)); passed(forgottenProject);
    const temporary = await turn('temporary-mode-honesty', `请长期记住：我的临时核对标签是“临时-${tag}”，用于所有协作。`, session(undefined, { temporary: true }));
    assert.ok(!temporary.tools.some(tool => tool.name === 'personal_memory' && tool.details?.status === 'saved'));
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM user_assertions WHERE statement LIKE ?').get(`%临时-${tag}%`)!.n), 0); passed(temporary);
    const rebuildStarted = Date.now();
    const rebuild = await api('/api/memory-learning/rebuild', { conversationId: primary });
    assert.ok(rebuild.jobId, 'Historical learning rebuild was not queued');
    let learning;
    while (Date.now() - rebuildStarted < 180000) {
      learning = (await api(`/api/memory-learning/jobs/${rebuild.jobId}`)).job;
      if (['succeeded', 'failed', 'canceled'].includes(learning.state)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const rebuildCase = { name: 'forgotten-history-rebuild', job: learning, durationMs: Date.now() - rebuildStarted, passed: false };
    report.cases.push(rebuildCase); persist();
    assert.equal(learning.state, 'succeeded', `Historical learning failed: ${JSON.stringify(learning)}`);
    for (const forbidden of [oldValue, newValue]) {
      assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM user_assertions WHERE statement LIKE ? AND status IN ('active','candidate','needs_review')").get(`%${forbidden}%`)!.n), 0, 'Forgotten preference restored by historical learning');
    }
    for (const forbidden of [value, revisedValue]) {
      assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM knowledge_items WHERE content LIKE ? AND status IN ('active','candidate','needs_review')").get(`%${forbidden}%`)!.n), 0, 'Forgotten knowledge restored by historical learning');
    }
    passed(rebuildCase as any);
    const afterLearning = await turn('after-rebuild-forgotten', '当前项目的交付验收入口名称，以及我偏好的工作日报结尾标记各是什么？只按有效记忆回答，已要求忘记的不要重建。', session(undefined, { projectId: project.id, cwd: projectRoot }));
    for (const forbidden of [oldValue, newValue, value, revisedValue]) assert.ok(!afterLearning.reply.includes(forbidden));
    passed(afterLearning);

  }
  }
  for (const [path, hash] of Object.entries(report.sourceHashes)) {
    assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), hash, `Source changed during live run: ${path}`);
  }
  report.success = true;
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
  console.error(JSON.stringify({ failure: report.errors.at(-1) }));
} finally {
  report.completedAt = new Date().toISOString();
  db = getSqliteDatabase();
  report.usage = db.prepare('SELECT operation,provider,model,status,duration_ms FROM ai_usage_events ORDER BY started_at').all();
  report.scopeRows = db.prepare('SELECT scope_type,scope_id,status,content FROM knowledge_items').all();
  report.limitations = process.env.XOPC_MEMORY_LIVE_CASES === 'learning'
    ? 'Synthetic conversations; real configured model with authenticated Gateway and signed browser endpoint. Automatic idle learning is held during seeds, then the actual persisted background worker is forced and replayed. No visual UI acceptance, production memories or multi-model statistics.'
    : process.env.XOPC_MEMORY_LIVE_CASES === 'recall'
    ? 'Synthetic corpus and noise fixtures; real configured model with authenticated Gateway and signed browser endpoint. Background learning is held; no visual UI acceptance, production memories or multi-model statistics.'
    : 'Synthetic fixtures; real configured model, authenticated HTTP and signed browser WebSocket endpoint. Background learning is held during foreground checks, then a historical rebuild is forced. No visual UI acceptance; no production memory copied.';
  persist(); console.log(JSON.stringify({ reportPath, success: report.success, completed: report.cases.filter((entry: any) => entry.passed).length, directory }));
  await stop(); closeXopcDatabase();
  for (const name of readdirSync(directory)) if (name === 'models.json' || name.startsWith('xopc.json')) rmSync(join(directory, name), { force: true });
}
process.exit(process.exitCode ?? 0);
