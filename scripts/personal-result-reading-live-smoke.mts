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

assert.equal(process.env.XOPC_RESULT_READ_LIVE, '1', 'This script requires explicit authorization for real model usage');
const fingerprintPaths = ['src/personal-agent/result-reader.ts', 'src/personal-agent/result-extraction.ts',
  'src/personal-agent/result-read-continuations.ts', 'src/agent/tools/personal-result-tool.ts',
  'src/agent/source-context/result-context.ts', 'src/personal-agent/prompts.ts', 'src/personal-agent/policy.ts',
  'src/personal-agent/request-delivery.ts', 'src/session/session-context-for-llm.ts', 'src/gateway/service.ts',
  'src/storage/sqlite/schema.sql', 'src/agent/tools/factory.ts',
  'web/src/features/chat/messages/message-bubble.tsx', 'web/src/features/chat/composer/chat-composer.tsx',
  'web/src/features/chat/messages/message-context-attachments.tsx', 'scripts/build-personal-result-worker.mjs',
  'scripts/build-electron-server.mjs', 'scripts/tsdown-build.mjs', 'tsdown.config.ts',
  'scripts/personal-result-reading-live-smoke.mts', 'pnpm-lock.yaml'];
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
const directory = mkdtempSync(join(tmpdir(), 'xopc-personal-result-live-'));
const token = randomUUID();
const reportPath = resolve(process.env.XOPC_RESULT_READ_REPORT ?? 'docs/design/technical/personal-result-reading-live-2026-10-15.json');
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
for (const agent of catalog.list({ readyOnly: true })) if (agent.workspace) {
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
    const value = await response.json();
    assert.ok(response.ok, `Gateway ${response.status}: ${JSON.stringify(value)}`);
    return value;
  };
  await api('/api/personal-agent');
  const append = async (name: string, content: string, contextRefs?: unknown[]) => {
    const session = db.prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id = ?').get(personal.conversation_id)!;
    const version = db.prepare('SELECT updated_at FROM session_config WHERE conversation_id = ?').get(personal.conversation_id)!;
    return api(`/api/sessions/${personal.conversation_id}/inputs`, { kind: 'append', clientMessageId: `${marker}-${name}`,
      expectedTranscriptId: session.active_transcript_id, configVersion: version.updated_at, delivery: 'next',
      input: { content, ...(contextRefs ? { contextRefs } : {}) }, origin: { type: 'system', source: 'cli' } });
  };
  const inputRow = (name: string) => db.prepare('SELECT id,status,created_at_ms,updated_at_ms,error FROM session_inputs WHERE conversation_id = ? AND client_message_id = ?')
    .get(personal.conversation_id, `${marker}-${name}`) as { id: string; status: string; created_at_ms: number; updated_at_ms: number; error: string | null } | undefined;
  const until = async (predicate: () => boolean, timeout = 90_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Timed out waiting for verification state');
  };
  const started = Date.now();
  await append('publish', '请安排执行者交付已准备好的文件包：把工作区 source-report.md 原样复制为 report.md，运行现有 node reproduce.mjs 检查它和 monthly_summary.csv，然后只发布 report.md、monthly_summary.csv、reproduce.mjs 三个文件。文件及检查脚本已准备好，不需要新增分析、研究或改写。允许在隔离工作区复制文件、运行这个检查脚本并发布指定三文件。最终回复只说明交付情况，不复述文件正文或附录核对码。不要让主对话等待执行。');
  await until(() => inputRow('publish')?.status === 'completed' && Boolean(db.prepare("SELECT 1 FROM task_runs WHERE status = 'running'").get()));
  const pingStart = Date.now();
  await append('ping', `现在只回复 ${marker}-READY，不等待后台工作，不查询状态。`);
  await until(() => inputRow('ping')?.status === 'completed');
  const pingMs = Date.now() - pingStart;
  await until(() => Boolean(db.prepare("SELECT 1 FROM task_result_deliveries WHERE reply_status = 'delivered'").get()), 300_000);
  const deliveryRow = db.prepare('SELECT delivery_id,payload_json,reply_text FROM task_result_deliveries LIMIT 1').get() as {
    delivery_id: string; payload_json: string; reply_text: string;
  };
  const delivery = JSON.parse(deliveryRow.payload_json);
  const mainHistory = (await api(`/api/sessions/${personal.conversation_id}/history?view=compact`)).session.messages;
  assert.ok(mainHistory.some((message: { content: string }) => message.content === `${marker}-READY`));
  assert.ok(!deliveryRow.reply_text.includes(tailCode), 'The tail fact must not be present in the composed reply');
  const artifacts = delivery.outcome.deliverables;
  const publishToReplyMs = Date.now() - started;
  result = { pingMs, publishToReplyMs };
  const downloads: unknown[] = [];
  for (const [title, expected] of [['report.md', reportText], ['monthly_summary.csv', tableText], ['reproduce.mjs', verifyScript]]) {
    const artifact = artifacts.find((item: { title: string }) => item.title === title);
    assert.equal(artifact?.availability, 'available');
    const url = `${base}/api/media/read?uri=${encodeURIComponent(artifact.uri)}&conversationId=${personal.conversation_id}`;
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.toString('utf8'), expected, `Published bytes changed: ${title}`);
    downloads.push({ title, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const reportArtifact = artifacts.find((item: { title: string }) => item.title === 'report.md');
  await stopPersonalResultPreparations();
  db.prepare('DELETE FROM personal_result_documents WHERE delivery_id = ? AND source_id = ?').run(deliveryRow.delivery_id, reportArtifact.artifactId);
  const before = { tasks: Number(db.prepare('SELECT count(*) AS n FROM tasks').get()!.n),
    routers: Number(db.prepare("SELECT count(*) AS n FROM ai_usage_events WHERE operation='task.allocation' AND status='succeeded'").get()!.n) };
  assert.ok(before.routers > 0, 'The real Router must select the executor');
  const followups: unknown[] = [];
  result.followups = followups;
  const ask = async (name: string, question: string, contextRefs?: unknown[]) => {
    const start = performance.now(); const index = toolCalls.length;
    await append(name, question, contextRefs);
    await until(() => {
      const input = inputRow(name);
      if (input?.status === 'failed') throw new Error(input.error ?? 'Input failed');
      if (input?.status !== 'completed') return false;
      const wait = db.prepare('SELECT status FROM personal_result_read_waits WHERE input_id = ?').get(input.id);
      return !wait || ['done', 'stale'].includes(String(wait.status));
    });
    const history = (await api(`/api/sessions/${personal.conversation_id}/history?view=compact`)).session.messages;
    const answer = history.filter((message: { role: string; content?: string; metadata?: { taskResultDelivery?: unknown } }) =>
      message.role === 'assistant' && message.content?.trim() && !message.metadata?.taskResultDelivery).at(-1)?.content ?? '';
    const reading = { name, question, answer, durationMs: performance.now() - start, calls: toolCalls.slice(index) };
    followups.push(reading); console.log(JSON.stringify({ followup: name, durationMs: reading.durationMs, tools: reading.calls.map(call => call.name) }));
    return reading;
  };
  const first = await ask('tail', '刚才 report.md 第三节的核对码是什么？适用范围有什么限制？请根据原文件回答。');
  assert.ok(first.answer.includes(tailCode)); assert.match(first.answer, /隔离|验收样本/);
  assert.ok(first.calls.some(call => call.name === 'personal_result'));
  const ref = (artifactId: string) => [{ kind: 'result', sourceId: resultReferenceId(deliveryRow.delivery_id, artifactId),
    expectedVersion: resultReferenceVersion(delivery) }];
  const second = await ask('selected', '只针对我选中的成果，引用第三节标题和该节原文。', ref(reportArtifact.artifactId));
  assert.ok(second.answer.includes(tailCode));
  const csv = artifacts.find((item: { title: string }) => item.title === 'monthly_summary.csv');
  const third = await ask('table', '把我选中的 CSV 原始表头和所有数据行原样列出来。', ref(csv.artifactId));
  assert.ok(third.answer.includes('month,total') && third.answer.includes('2026-01,150') && third.answer.includes('2026-02,210'));
  assert.ok(third.calls.some(call => call.name === 'personal_result'));
  const hotMs: number[] = [];
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    const value = await readPersonalResult(personal.conversation_id, { command: 'search', resultId: deliveryRow.delivery_id, sourceId: reportArtifact.artifactId, query: '核对码' });
    assert.ok(JSON.stringify(value).includes(tailCode)); hotMs.push(performance.now() - start);
  }
  assert.equal(Number(db.prepare('SELECT count(*) AS n FROM tasks').get()!.n), before.tasks);
  assert.equal(Number(db.prepare("SELECT count(*) AS n FROM ai_usage_events WHERE operation='task.allocation' AND status='succeeded'").get()!.n), before.routers);
  assert.ok(!toolCalls.some(call => call.failed), 'Personal tools must not fail');
  result = { downloads, outcomeStatus: delivery.outcome.status,
    artifacts: artifacts.map((artifact: { title: string; availability: string }) => ({ title: artifact.title, availability: artifact.availability })),
    workerToolErrors: Number(db.prepare(`SELECT count(*) AS n FROM transcript_entries e JOIN transcripts t ON t.transcript_id = e.transcript_id
      WHERE t.conversation_id != ? AND e.role = 'toolResult' AND json_extract(e.payload_json, '$.isError') = 1`).get(personal.conversation_id)!.n),
    pingMs, publishToReplyMs, totalMs: Date.now() - started, followups, hotReadMs: hotMs.sort((a, b) => a - b), before,
    readWaits: db.prepare('SELECT status FROM personal_result_read_waits').all() };
  if (process.env.XOPC_RESULT_READ_BROWSER === '1') {
    const playwright = await import('playwright-core');
    const chromium = playwright.chromium ?? playwright.default.chromium;
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const context = await browser.newContext({ locale: 'zh-CN' });
      assert.equal((await context.request.post(`${base}/api/browser-session`, { headers: { Authorization: `Bearer ${token}`, Origin: base } })).status(), 200);
      const page = await context.newPage();
      await page.goto(`${base}/#/personal`);
      await page.locator('[data-result-follow-up] button').first().waitFor({ timeout: 30_000 });
      await page.locator('[data-result-follow-up] button').filter({ hasText: 'report.md' }).first().click();
      const pending = page.waitForRequest(request => request.url().includes(`/api/sessions/${personal.conversation_id}/inputs`) && request.method() === 'POST');
      const editor = page.locator('[role="textbox"][contenteditable="true"]').last();
      await editor.fill('请只核对选中报告第三节的核对码。');
      await page.getByRole('button', { name: /^(发送|Send message)$/ }).last().click();
      const submitted = await pending;
      assert.ok((await submitted.response())?.ok(), 'Browser input must be accepted by the authenticated Gateway');
      const sent = submitted.postDataJSON();
      assert.equal(sent.input.contextRefs[0].kind, 'result');
      assert.equal(sent.input.contextRefs[0].sourceId, resultReferenceId(deliveryRow.delivery_id, reportArtifact.artifactId));
      await until(() => db.prepare('SELECT status FROM session_inputs WHERE conversation_id = ? AND client_message_id = ?')
        .get(personal.conversation_id, sent.clientMessageId)?.status === 'completed');
      assert.equal(Number(db.prepare('SELECT count(*) AS n FROM tasks').get()!.n), before.tasks);
      const screenshot = reportPath.replace(/\.json$/, '-web.png');
      await page.screenshot({ path: screenshot });
      result.browser = { success: true, sourceId: sent.input.contextRefs[0].sourceId, screenshot };
      await context.close();
    } finally { await browser.close(); }
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ failure })); process.exitCode = 1;
} finally {
  const sourceChangedDuringRun = JSON.stringify(initialSourceHashes) !== JSON.stringify(sourceFingerprint());
  if (sourceChangedDuringRun && !failure) { failure = 'Source changed during verification'; process.exitCode = 1; }
  const usage = db.prepare('SELECT operation,provider,model,status,duration_ms FROM ai_usage_events ORDER BY started_at').all();
  result = { ...result, success: !failure, failure, marker, toolCalls, usage, isolatedStateDirectory: directory,
    models: { personal: selection.model_override, global: JSON.parse(settings.defaults_json).models.chat.primary },
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceHashes: initialSourceHashes,
    sourceChangedDuringRun,
    limitations: 'Real models and authenticated Gateway; synthetic frozen file package. The verification script includes an explicit 8s delay to expose concurrent chat. This is not production p95 or native-device acceptance.' };
  mkdirSync(join(reportPath, '..'), { recursive: true }); writeFileSync(reportPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ reportPath, success: !failure }));
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  await service.stop(); await stopPersonalResultPreparations(); closeXopcDatabase();
  for (const name of readdirSync(directory)) if (name === 'xopc.json' || name.startsWith('xopc.json.')) rmSync(join(directory, name), { force: true });
}
process.exit(process.exitCode ?? 0);

