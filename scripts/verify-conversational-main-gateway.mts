/** Real main-Agent HTTP/input-queue smoke; only isolated synthetic product state is mutated. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { hasAffirmativeClaim } from './conversational-setup-evaluation/audit.js';

const { values } = parseArgs({ options: {
  model: { type: 'string', default: 'openai/gpt-5.6-sol' },
  out: { type: 'string', default: '.xopc-evals/conversational-setup/main-gateway.json' },
  'full-tools': { type: 'boolean' },
  agent: { type: 'string', default: 'main' },
  cases: { type: 'string' },
  'no-manual': { type: 'boolean' },
} });
assert.equal(process.env.XOPC_SETUP_EVAL_LIVE, '1', 'Explicit live-model authorization is required');
const currentAgentId = values.agent;
assert.ok(['main','coder'].includes(currentAgentId), 'Acceptance Agent must be main or coder');
const state = mkdtempSync(join(tmpdir(), 'xopc-main-setup-gateway-'));
const workspace = join(state, 'workspace'); mkdirSync(workspace);
const token = randomUUID();
process.env.XOPC_CREDENTIALS_DIR ??= join(homedir(), '.xopc', 'credentials');
process.env.XOPC_STATE_DIR = state;
process.env.XOPC_CONFIG_PATH = join(state, 'xopc.json');
process.env.XOPC_CONFIG = process.env.XOPC_CONFIG_PATH;
process.env.XOPC_WORKSPACE = workspace;
process.env.XOPC_LOG_LEVEL = 'fatal';
process.env.XOPC_LOG_DIR = join(state, 'logs');
writeFileSync(process.env.XOPC_CONFIG_PATH, JSON.stringify({
  gateway: { host: '127.0.0.1', auth: { mode: 'token', token }, tailscale: { mode: 'off' } },
  channels: {}, userContext: { enabled: false },
}), { mode: 0o600 });
const { openXopcDatabase, closeXopcDatabase, getSqliteDatabase, setSessionConfig } = await import('../src/storage/sqlite/index.js');
const { AgentCatalogRepository } = await import('../src/agent-catalog/repository.js');
const { AgentDefaultsSchema } = await import('../src/agent-config/schema.js');
const { createConversation } = await import('../src/storage/sqlite/conversation-repository.js');
const { GatewayService } = await import('../src/gateway/service.js');
const { createHonoApp } = await import('../src/gateway/hono/app.js');
const { serve } = await import('@hono/node-server');

openXopcDatabase({ path: join(state, 'xopc.db') });
const db = getSqliteDatabase(), catalog = new AgentCatalogRepository();
catalog.ensureInitialized(AgentDefaultsSchema.parse({ models: { chat: { primary: values.model }, intents: {} } }));
assert.ok(!(values['no-manual'] && values['full-tools']), 'Choose full default tools or an explicit product-only surface');
const toolAvailability = values['full-tools'] ? {} : { toolAllowlist: values['no-manual'] ? ['xopc_use'] : ['xopc_use', 'tool_manual', 'skills_list', 'skill_view'] };
const main = catalog.get('main')!;
catalog.update('main', main.revision, { id: 'main', enabled: true, workspace,
  profile: { name: 'Ada', description: '保留这段简介', language: 'zh-CN', style: '简洁' },
  ...toolAvailability,
});
catalog.markProvisioned('main');
if (currentAgentId === 'coder') catalog.create({ id: 'coder', enabled: true, workspace, ...toolAvailability, profile: { name: 'Ada', description: '保留这段简介', language: 'zh-CN', style: '简洁' } }, { ready: true });
const tests = [
  { id: 'rename', prompt: `把你自己这个 ${currentAgentId} Agent 改名为小舟，保留简介、语言、风格和其他配置。直接保存。` },
  { id: 'draft', prompt: '创建一个名为“阅读提醒”的自动化，每天北京时间早上9点提醒我读书。保存但保持关闭，禁止试运行。' },
  { id: 'voice', prompt: '帮我开启语音聊天并做录音测试。如果工具不支持，请给我正确的语音设置入口并说明还需要做什么，不能假装测试通过。' },
  { id: 'negative', prompt: '只给三个适合助手的中文名字，不创建任何东西。' },
].filter(test => !values.cases || values.cases.split(',').includes(test.id)).map(test => ({ ...test, conversationId: randomUUID(), clientMessageId: randomUUID() }));
for (const test of tests) {
  createConversation({ agentId: currentAgentId, sourceChannel: 'webchat', name: `Main setup ${test.id}` }, state, test.conversationId);
  setSessionConfig(test.conversationId, { modelOverride: values.model, fixedModel: true, thinkingLevel: 'low' }, state);
}
const report: Record<string, any> = { model: values.model, agent: currentAgentId, personalAgent: false, state,
  toolSurface: values['full-tools'] ? `${currentAgentId} configured default tools` : values['no-manual'] ? 'xopc_use only; no manual' : 'product-only allowlist',
  scope: 'Real authenticated Gateway, session input queue, production prompt/tool factory and SQLite. No microphone, mailbox or external write acceptance.', cases: [], passed: false };
const service = new GatewayService({ configPath: process.env.XOPC_CONFIG_PATH, enableHotReload: false, listenPort: 0 });
let server: ReturnType<typeof serve> | undefined;
try {
  await service.start();
  server = serve({ fetch: createHonoApp({ service }).fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  assert.equal((await fetch(base + '/api/sessions')).status, 401);
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
    const value = await response.json();
    assert.ok(response.ok, `HTTP ${response.status}: ${JSON.stringify(value)}`); return value;
  };
  const profileDescriptor = await api('/api/capabilities/operations/xopc.agents.patch_profile') as { majorVersion: number; descriptorDigest: string };
  const profileCall = { majorVersion: profileDescriptor.majorVersion, descriptorDigest: profileDescriptor.descriptorDigest,
    idempotencyKey: 'http-profile-acceptance', input: { id: currentAgentId,
      expectedRevision: catalog.get(currentAgentId)!.revision, patch: { name: 'Ada' } } };
  const profileReceipt = await api('/api/capabilities/operations/xopc.agents.patch_profile/invocations', profileCall);
  assert.deepEqual(await api('/api/capabilities/operations/xopc.agents.patch_profile/invocations', profileCall), profileReceipt);
  assert.equal(catalog.get(currentAgentId)!.profile.description, '保留这段简介');
  const settingsDescriptor = await api('/api/capabilities/operations/xopc.settings.open') as { majorVersion: number; descriptorDigest: string };
  const invalidSettings = await fetch(base + '/api/capabilities/operations/xopc.settings.open/invocations', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ majorVersion: settingsDescriptor.majorVersion, descriptorDigest: settingsDescriptor.descriptorDigest,
      input: { section: 'connected-apps' } }), signal: AbortSignal.timeout(30_000),
  });
  assert.equal(invalidSettings.status, 400);
  report.capabilityHttpChecks = { profilePatch: true, idempotentReplay: true, preservedProfile: true, invalidSettingsRejected: true };
  for (const test of tests) {
    const otherMainBefore = currentAgentId === 'coder' ? JSON.stringify(catalog.get('main')) : undefined;
    const before = performance.now();
    const automationCountBefore = (await service.automationServiceInstance.list()).length;
    const session = db.prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id = ?').get(test.conversationId) as { active_transcript_id: string };
    const config = db.prepare('SELECT updated_at FROM session_config WHERE conversation_id = ?').get(test.conversationId) as { updated_at: number };
    await api(`/api/sessions/${test.conversationId}/inputs`, { kind: 'append', clientMessageId: test.clientMessageId,
      expectedTranscriptId: session.active_transcript_id, configVersion: config.updated_at, delivery: 'next',
      input: { content: test.prompt }, origin: { type: 'system', source: 'cli' } });
    let row: Record<string, unknown> | undefined;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      row = db.prepare('SELECT status,error FROM session_inputs WHERE conversation_id = ? AND client_message_id = ?').get(test.conversationId, test.clientMessageId);
      if (row && ['completed', 'failed', 'cancelled'].includes(String(row.status))) break;
      await new Promise(done => setTimeout(done, 500));
    }
    const history = await api(`/api/sessions/${test.conversationId}/history?view=compact`) as { session: { messages: Array<{ role: string; content: unknown }> } };
    const reply = history.session.messages.filter((message: {role:string})=>message.role==='assistant').map((message:{content:unknown})=>typeof message.content==='string'?message.content:JSON.stringify(message.content)).join('\n');
    const saved = catalog.get(currentAgentId)!;
    const automations = await service.automationServiceInstance.list();
    const checks: Record<string, boolean> = { completed: row?.status === 'completed', visibleReply: Boolean(reply.trim()) };
    if (otherMainBefore) checks.otherMainUnchanged = JSON.stringify(catalog.get('main')) === otherMainBefore;
    if (test.id === 'rename') { checks.savedName = saved.profile.name === '小舟'; checks.preservedProfile = saved.profile.description === '保留这段简介' && saved.profile.style === '简洁' && saved.profile.language === 'zh-CN'; }
    if (test.id === 'draft') { const item=automations.find((a:{name:string})=>a.name==='阅读提醒');checks.createdDisabled=item?.enabled===false;checks.correctSchedule=item?.trigger.kind==='schedule'&&item.trigger.schedule.kind==='cron'&&item.trigger.schedule.expr==='0 9 * * *'&&item.trigger.schedule.tz==='Asia/Shanghai';checks.noRun=Boolean(item)&&(await service.automationServiceInstance.listRuns({automationId:item.id})).length===0; }
    if (test.id === 'voice') { checks.pending=/需要|尚未|不能|无法|不支持/.test(reply);checks.noFalseTest=!hasAffirmativeClaim(reply,/测试(已)?通过|录音.{0,8}成功/);checks.settingsLink=/id=capabilities(?:%2F|\/)voice|\/settings\/capabilities\/voice/i.test(reply); }
    if (test.id === 'negative') checks.noNewAutomation=automations.length===automationCountBefore;
    report.cases.push({ id:test.id,conversationId:test.conversationId,elapsedMs:Math.round(performance.now()-before),checks,inputStatus:row?.status,inputError:row?.error,reply });
    console.log(JSON.stringify({id:test.id,checks}));
    assert.ok(Object.values(checks).every(Boolean), `Main Gateway case failed: ${test.id}`);
  }
  report.passed = true;
} catch (error) { report.error=error instanceof Error?error.message:String(error);process.exitCode=1; }
finally {
  await service.stop(); if(server)await new Promise<void>(done=>server!.close(()=>done()));closeXopcDatabase();
  const output = resolve(values.out);mkdirSync(resolve(output,'..'),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({report:output,passed:report.passed,error:report.error}));
}
// Gateway dependencies can retain idle timers after all acceptance receipts are flushed.
process.exit(process.exitCode ?? 0);
