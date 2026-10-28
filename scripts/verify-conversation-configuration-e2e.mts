/** Real model + production Web Chat. Fixtures supply artifacts; never model responses or configuration actions. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import AdmZip from 'adm-zip';
import type { Browser, BrowserContext, Page, Video } from 'playwright-core';
import { createWeixinConfigurationTestServer } from './weixin-configuration-test-server.mts';
import { DatabaseSync } from 'node:sqlite';
import { createConfigurationTestServers } from './conversation-configuration-test-server.mts';
import { createDiscoveryFixtures } from './mcp-discovery-fixtures.mts';

const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');
const inheritedEnv = { ...process.env };

assert.equal(process.env.XOPC_CONFIGURATION_E2E_LIVE, '1', 'Set XOPC_CONFIGURATION_E2E_LIVE=1 for real model inference');
const stage = process.env.XOPC_CONFIGURATION_E2E_STAGE ?? 'skills';
const token403Only = stage === 'mcp' && process.env.XOPC_CONFIGURATION_E2E_TOKEN_403_ONLY === '1';
const onlineFlow = stage === 'mcp' && process.env.XOPC_CONFIGURATION_E2E_ONLINE === '1';
const nameFlow = stage === 'mcp' && process.env.XOPC_CONFIGURATION_E2E_NAME_FLOW === '1';
const recordDemo = process.env.XOPC_CONFIGURATION_E2E_RECORD_DEMO === '1';
assert(!recordDemo || ['automations', 'weixin'].includes(stage), 'Recording demo uses the automations or Weixin environment');
assert(['skills', 'mcp', 'automations', 'weixin'].includes(stage), 'Choose skills, mcp or automations');
const weixin = stage === 'weixin' ? await createWeixinConfigurationTestServer() : undefined;
const testServers = stage !== 'skills' ? await createConfigurationTestServers({ rotateCodes: stage === 'automations', ...(token403Only || nameFlow ? { tokenRefusalStatus: 403 } : {}), ...(nameFlow ? { publicOrigin: 'https://mcp-fixture.example', oauthOrigin: 'https://auth-fixture.example' } : {}) }) : undefined;
const deniedServers = weixin ? await createConfigurationTestServers() : undefined;
const root = await mkdtemp(join(tmpdir(), 'xopc-conversation-config-'));
const discoveryFixtures = nameFlow ? await createDiscoveryFixtures(root, testServers!) : undefined;
if (discoveryFixtures) await writeFile(join(root, 'network-routes.json'), JSON.stringify(discoveryFixtures.routes));
const evidence = resolve(process.env.XOPC_CONFIGURATION_E2E_OUT ?? `.xopc-evals/conversation-configuration/${stage}`);
await mkdir(evidence, { recursive: true });
const credentials = process.env.XOPC_CREDENTIALS_DIR ?? join(homedir(), '.xopc/credentials');
const credentialFile = join(credentials, 'oauth/xopc-cloud.json');
assert(existsSync(credentialFile), 'A signed-in XOPC Cloud account is required');
const modelRequests: Array<{ status: number; elapsedMs: number; mcpSetupDeclared: boolean; toolSearchDeclared: boolean }> = [];
let refreshing: Promise<void> | undefined;
async function refreshCloudLogin() {
  if (!refreshing) refreshing = (async () => {
    const refresh = spawn(process.execPath, ['--import', 'tsx', '--input-type=module'], { cwd: resolve('.'),
      env: { ...inheritedEnv, XOPC_CREDENTIALS_DIR: credentials }, stdio: ['pipe', 'ignore', 'ignore'] });
    refresh.stdin!.end("import { CredentialResolver } from './src/auth/credentials.ts'; const key = await new CredentialResolver().resolveApiKey('xopc-cloud'); process.exit(key ? 0 : 1);");
    assert.equal((await once(refresh, 'exit'))[0], 0, 'Cloud login refresh failed');
  })().finally(() => { refreshing = undefined; });
  await refreshing;
}
const proxy = createServer(async (request, response) => {
  try {
    let raw = ''; for await (const chunk of request) raw += chunk;
    assert(![...(testServers?.sensitive ?? [])].some(secret => raw.includes(secret)), 'A credential leaked into a model request');
    const body = JSON.parse(raw); body.model = 'openai-codex/gpt-5.6-sol';
    if (stage === 'mcp') await writeFile(join(evidence, `request-${randomUUID()}.private.json`), JSON.stringify(body), { mode: 0o600 });
    assert(modelRequests.length < (nameFlow ? 450 : stage === 'skills' ? 160 : 260), 'Inference budget exceeded');
    let credential = JSON.parse(await readFile(credentialFile, 'utf8'));
    if (credential.expiresAt <= Date.now() + 60000) { await refreshCloudLogin(); credential = JSON.parse(await readFile(credentialFile, 'utf8')); }
    assert(credential.expiresAt > Date.now(), 'Cloud login expired; reconnect before running acceptance');
    const before = Date.now();
    const upstream = await fetch('https://router.xopc.ai/v1/chat/completions', { method: 'POST',
      headers: { Authorization: `Bearer ${credential.access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(150_000) });
    const names = (body.tools ?? []).map((tool: any) => tool.function?.name ?? tool.name);
    modelRequests.push({ status: upstream.status, elapsedMs: Date.now() - before,
      mcpSetupDeclared: names.includes('mcp_setup'), toolSearchDeclared: names.includes('tool_search') });
    response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
    if (upstream.body) for await (const chunk of upstream.body) response.write(chunk);
    response.end();
  } catch { response.writeHead(502).end(JSON.stringify({ error: 'Real inference unavailable' })); }
});
proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
const proxyPort = (proxy.address() as { port: number }).port;
const archive = new AdmZip();
archive.addFile('SKILL.md', Buffer.from('---\nname: weekly-report\ndescription: Summarize weekly sales with totals and the highest-selling product.\n---\nRead the supplied sales rows. Sum all amounts, identify the highest-selling product, and explain the result concisely. Never create schedules unless requested.\n'));
const fixture = createServer((request, response) => {
  if (request.url === '/weekly-report.zip') response.writeHead(200, { 'Content-Type': 'application/zip' }).end(archive.toBuffer());
  else response.writeHead(404).end();
});
fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
const artifactUrl = `http://127.0.0.1:${(fixture.address() as { port: number }).port}/weekly-report.zip`;
const probe = createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>(done => probe.close(() => done()));
const base = `http://127.0.0.1:${port}`, token = randomUUID();
const modelRef = 'configuration-live/sol';
Object.assign(process.env, { XOPC_STATE_DIR: root, XOPC_CONFIG_PATH: join(root, 'xopc.json'), XOPC_CONFIG: join(root, 'xopc.json'),
  XOPC_WORKSPACE: root, XOPC_MODELS_JSON: join(root, 'models.json'), PI_CODING_AGENT_DIR: join(root, 'pi'),
  XOPC_CREDENTIALS_DIR: join(root, 'credentials'), XOPC_UI_STATIC_ROOT: resolve('dist/gateway/static/root'), XOPC_BUNDLED_SKILLS_ROOT: join(root, 'bundled-skills'),
  XOPC_SKIP_CHANNELS: weixin ? '0' : '1', XOPC_NO_RESPAWN: '1', XOPC_LOG_CONSOLE: 'false', XOPC_LOG_FILE: 'false' });
await mkdir(join(root, 'home'));
await cp(resolve('skills'), join(root, 'bundled-skills'), { recursive: true });
await writeFile(join(root, 'xopc.json'), JSON.stringify({ gateway: { bind: 'loopback', port, auth: { mode: 'token', token }, ...(weixin ? { publicUrl: base } : {}) },
  ...(discoveryFixtures ? { tools: { web: { search: { providers: [{ type: 'searxng', url: discoveryFixtures.local }] } } } } : {}),
  ...(weixin ? { session: { dmScope: 'per-account-channel-peer' }, channels: { weixin: { enabled: true, dmPolicy: 'pairing', allowFrom: ['alice@im.wechat', 'bob@im.wechat'], streamMode: 'off' } } } : {}), userContext: { enabled: false } }), { mode: 0o600 });
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { 'configuration-live': { baseUrl: `http://127.0.0.1:${proxyPort}/v1`, api: 'openai-completions', apiKey: 'local-relay',
  models: [{ id: 'sol', name: 'Real XOPC Cloud GPT-5.6 Sol', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 4096 }] } } }));
if (weixin) {
  await mkdir(join(root, 'weixin/accounts'), { recursive: true });
  await writeFile(join(root, 'weixin/accounts.json'), JSON.stringify(Object.keys(weixin.tokens)));
  for (const [accountId, credential] of Object.entries(weixin.tokens)) await writeFile(join(root, `weixin/accounts/${accountId}.json`), JSON.stringify({ token: credential, baseUrl: weixin.baseUrl }), { mode: 0o600 });
}
const db = await import('../src/storage/sqlite/connection.js');
db.openXopcDatabase();
const { seedTestAgentCatalog } = await import('../src/agent-catalog/test-support.js');
const { AgentDefaultsSchema } = await import('../src/agent-config/schema.js');
seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: modelRef }, background: { primary: modelRef } }, runtime: { maxTurns: 32, timeoutMs: 300000, thinkingLevel: 'off' } }),
  agents: [{ id: 'main', enabled: true, workspace: root, profile: { name: 'Ada', language: 'zh' } },
    ...(stage === 'automations' ? [{ id: 'reviewer', enabled: true, workspace: root, profile: { name: 'Reviewer', language: 'zh' } }] : [])] });
db.closeXopcDatabase();
let child: ReturnType<typeof spawn>;
let logs = '';
function launch() {
  child = spawn(process.execPath, [...(nameFlow ? ['--experimental-test-module-mocks', '--import', resolve('scripts/fixtures/mcp-discovery-network.mjs')] : []), '--import', 'tsx', 'src/cli/bin.ts', 'gateway', '--port', String(port), '--no-hot-reload'], { cwd: resolve('.'),
    env: { ...process.env, HOME: join(root, 'home'), ...(nameFlow ? { XOPC_E2E_NETWORK_ROUTES: join(root, 'network-routes.json') } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout!.on('data', chunk => { logs = (logs + chunk).slice(-200000); });
  child.stderr!.on('data', chunk => { logs = (logs + chunk).slice(-200000); });
}
async function stopGateway() {
  if (child.exitCode !== null) return;
  const stopped = once(child, 'exit'); child.kill('SIGTERM');
  await Promise.race([stopped, delay(8000)]);
  if (child.exitCode === null) { child.kill('SIGKILL'); await stopped; }
}
async function ready() {
  await until(async () => { try { const response = await fetch(base + '/api/health'); return response.ok && (await response.json() as any).ready; } catch { return false; } }, 'Gateway ready', 90000);
}
async function until(check: () => Promise<boolean>, label: string, timeout = 240000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { assert(child.exitCode === null, 'Gateway exited'); if (await check()) return; await delay(500); }
  throw Error(`Timeout: ${label}`);
}
async function api(path: string) {
  const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  assert(response.ok, `${path}: HTTP ${response.status}`); const body = await response.json() as any; return body.payload ?? body.session ?? body;
}
let browser: Browser | undefined, page: Page, conversationId: string | undefined;
let recordingContext: BrowserContext | undefined, recordedVideo: Video | null = null;
const observedConversations = new Set<string>();
const report: any = { stage, model: 'xopc-cloud/openai-codex/gpt-5.6-sol', inference: 'real', entry: 'production Web Chat, 390px',
  fixture: 'Local archive with deterministic sales instructions; no mocked model or direct management API writes', root, cases: [], passed: false };
async function send(id: string, prompt: string, verify: (answer: string) => Promise<Record<string, boolean>>, fresh = false) {
  if (fresh || !conversationId) { await page.goto(base + '/#/chat/new'); conversationId = undefined; }
  const beforeState = conversationId ? await api(`/api/sessions/${conversationId}?include=transcriptRows`) : undefined;
  const before = beforeState?.transcriptRows?.length ?? 0;
  async function skipOptionalOnboarding() {
    for (const name of ['Maybe later, keep using my current model', 'Skip for now', '以后再说，继续使用当前模型', '暂时跳过']) {
      const choice = page.getByText(name, { exact: true }).first();
      if (await choice.isVisible()) {
        try { await choice.click({ timeout: 2000 }); } catch {
          assert(!await choice.isVisible(), 'Optional onboarding is still blocking chat');
        }
      }
    }
  }
  await skipOptionalOnboarding();
  const editor = page.locator('[role="textbox"][contenteditable="true"]').first();
  let sent = false;
  await until(async () => {
    await skipOptionalOnboarding();
    // Initial model hydration can replace the new-chat editor. Type into the current visible editor.
    try { if (await editor.innerText() !== prompt) await editor.fill(prompt, { timeout: 1000 }); }
    catch { return false; }
    const button = page.getByRole('button', { name: /^(Send|发送)$/ });
    if (!await button.isVisible() || !await button.isEnabled()) return false;
    if (recordDemo) await delay(1500);
    try { await button.click({ timeout: 1000 }); sent = true; return true; } catch { return false; }
  }, 'chat ready for a user tap', 60000);
  assert(sent);
  await until(async () => { const match = /#\/chat\/([0-9a-f-]{36})/.exec(page.url()); if (!match) return false; conversationId = match[1];
    const state = await api(`/api/sessions/${conversationId}/input-state`); return Boolean(state.activeRunId || state.inputs?.length); }, 'user message accepted', 60000);
  observedConversations.add(conversationId!);
  await until(async () => { const state = await api(`/api/sessions/${conversationId}/input-state`);
    const history = await api(`/api/sessions/${conversationId}?include=transcriptRows`);
    return !state.activeRunId && !state.inputs?.some((input: any) => ['queued', 'running'].includes(input.status)) && (history.transcriptRows?.length ?? 0) > before; }, id);
  const history = await api(`/api/sessions/${conversationId}?include=transcriptRows`);
  const rows = (history.transcriptRows ?? []).slice(before);
  const answer = rows.filter((row: any) => row.role === 'assistant').flatMap((row: any) => Array.isArray(row.content) ? row.content.filter((block: any) => block.type === 'text').map((block: any) => block.text) : []).join('\n');
  const checks = await verify(answer);
  const toolCalls = rows.filter((row: any) => row.role === 'assistant').flatMap((row: any) => Array.isArray(row.content) ? row.content.filter((block: any) => block.type === 'toolCall').map((block: any) => block.name) : []);
  checks.noStorageBypass = !toolCalls.some((name: string) => ['exec_command', 'write_file', 'apply_patch'].includes(name));
  if (id === 'install-and-use') checks.skillLoaded = toolCalls.includes('skill_view');
  if (id === 'marketplace-search') {
    const results = rows.filter((row: any) => row.role === 'toolResult' && row.toolName === 'skills_marketplace_search')
      .flatMap((row: any) => row.content ?? []).filter((block: any) => block.type === 'text').flatMap((block: any) => {
        try { const result = JSON.parse(block.text); return result.success ? result.results ?? [] : []; } catch { return []; }
      });
    checks.realMarketSearch = toolCalls.includes('skills_marketplace_search') && results.length >= 2;
  }
  // The chat virtualizes long replies, so inspect the visible tail rather than an unmounted beginning.
  const visibleAnswer = answer.replace(/^\s*\d+[.)]\s+/gm, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[^\p{L}\p{N}]/gu, '').slice(-8);
  checks.visibleReply = false;
  if (visibleAnswer) {
    try { await page.waitForFunction(excerpt => {
      const replies = document.querySelectorAll('[data-chat-message-row] [data-chat-find-text]');
      return (replies.item(replies.length - 1)?.textContent ?? '').replace(/[^\p{L}\p{N}]/gu, '').includes(excerpt);
    }, visibleAnswer, { timeout: 15000 }); checks.visibleReply = true; } catch { /* Retain a failed visible-output check. */ }
  }
  checks.noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  report.cases.push({ id, prompt, conversationId, answer, toolCalls, checks, passed: Object.values(checks).every(Boolean) });
  await page.screenshot({ path: join(evidence, id + '.png'), fullPage: true });
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ ...report, modelRequests }, null, 2));
  console.log(JSON.stringify({ id, checks }));
  assert(Object.values(checks).every(Boolean), `User acceptance failed: ${id}`);
  if (recordDemo) await delay(3000);
}
const installed = () => existsSync(join(root, 'skills/weekly-report/SKILL.md'));
const enabled = async () => JSON.parse(await readFile(join(root, 'skills.json'), 'utf8')).entries?.['weekly-report']?.enabled;
const configuredServers = async () => JSON.parse(await readFile(join(root, 'xopc.json'), 'utf8')).mcp?.servers ?? {};
async function configuredNamedServer(name: string): Promise<any> {
  const entry = (Object.entries(await configuredServers()) as Array<[string, Record<string, unknown>]>)
    .find(([id, server]) => id === name || server.displayName === name);
  return entry ? { ...entry[1], id: entry[0] } : undefined;
}
async function openSetupInteraction() {
  await page.getByRole('link', { name: /^(完成连接|Complete connection)$/ }).click();
}
async function continuation(id: string, service: 'token' | 'oauth') {
  const code = testServers!.codes[service];
  await page.waitForURL(/#\/chat\/[0-9a-f-]{36}/, { timeout: 120000 });
  await until(async () => {
    const h = await api(`/api/sessions/${conversationId}?include=transcriptRows`);
    const state = await api(`/api/sessions/${conversationId}/input-state`);
    return JSON.stringify(h.messages ?? []).includes(code) && !state.activeRunId && !state.inputs?.some((input: any) => ['queued', 'running'].includes(input.status));
  }, 'original objective resumed after authorization');
  const history = await api(`/api/sessions/${conversationId}?include=transcriptRows`);
  const storedConfig = JSON.stringify(await configuredServers());
  const checks = { actualRead: testServers!.calls.some(call => call.service === service && call.account === 'fixture-reader'),
    uniqueResult: JSON.stringify(history.messages ?? []).includes(code),
    noSecretsInTranscript: ![...testServers!.sensitive].some(secret => JSON.stringify(history).includes(secret)),
    noSecretsInConfig: ![...testServers!.sensitive].some(secret => storedConfig.includes(secret)),
    returnedToOriginalChat: page.url().includes(conversationId!) };
  report.cases.push({ id, checks, passed: Object.values(checks).every(Boolean) });
  await page.screenshot({ path: join(evidence, id + '.png'), fullPage: true });
  console.log(JSON.stringify({ id, checks })); assert(Object.values(checks).every(Boolean), id);
}
async function negativeChecks() {
  const snapshot = async () => JSON.stringify({
    global: (await readdir(join(root, 'skills')).catch(() => [])).sort(),
    workspace: (await readdir(join(root, '.xopc/skills')).catch(() => [])).sort(),
    mcp: await configuredServers(),
    externalReads: testServers?.calls.length ?? 0,
    skillConfig: await readFile(join(root, 'skills.json'), 'utf8').catch(() => ''),
    automations: (await api('/api/automations')).automations.map((item: any) => item.id).sort(),
  });
  const baseline = await snapshot();
  const negativePrompts = [
    '帮我写一句周报开头，只给一句。', '给我三个周报标题，不用创建文件。', '解释 Skill 是什么，不做配置。',
    'MCP 和普通 API 有什么区别？只解释。', '每天整理销售有什么好处？不要安排任务。',
    '把“本周完成销售分析”改得自然一点。', '给出苹果10元和梨20元的总额，不安装工具。',
    '我暂时不想装新能力，给一句建议即可。', '如何判断一个技能是否适合我？不执行任何操作。',
    '“以后可能需要周报”这句话帮我翻译成英文，不要安排。',
    'Suggest two names for a weekly report. Do not create anything.',
    'Explain what a skill does in one sentence. No configuration changes.',
    'Translate “本周销售汇总” into English. Just the translation.',
    'Give me a short checklist for writing a report, without installing anything.',
    'What is a timezone? Explain only, do not schedule anything.',
    'Summarize this text: We sold apples and pears. One sentence only.',
    'I might want a reminder someday. Do not create one; just acknowledge.',
    'What should I consider before connecting a service? Advice only.',
    'Rewrite: Sales improved this week. Do not save a document.',
    'Tell me the difference between disabling and uninstalling. Do not change my setup.',
  ];
  for (const [index, prompt] of negativePrompts.entries()) {
    await send(`negative-${String(index + 1).padStart(2, '0')}`, prompt, async () => ({ noConfigurationMutation: await snapshot() === baseline }), true);
  }
}

async function verifyWeixin() {
  report.entry = 'Production Weixin protocol channel plus secure Web page at 390px';
  report.fixture = 'Independent local ilink, Token MCP and OAuth protocol servers; real model and actual product adapters';
  report.scope = 'Real model + production Weixin long-poll/inbound/outbound adapters + real browser + local ilink/MCP/OAuth servers. Not official WeChat service or physical phone acceptance.';
  const observer = new DatabaseSync(join(root, 'xopc.db'), { readOnly: true });
  const cases = async (id: string, checks: Record<string, boolean>) => {
    report.cases.push({ id, checks, passed: Object.values(checks).every(Boolean) });
    await page.screenshot({ path: join(evidence, `${id}.png`), fullPage: true });
    await writeFile(join(evidence, 'result.json'), JSON.stringify({ ...report, modelRequests }, null, 2));
    console.log(JSON.stringify({ id, checks })); assert(Object.values(checks).every(Boolean), id);
  };
  const route = (peer: string) => observer.prepare('SELECT conversation_id FROM sessions WHERE source_channel = ? AND source_chat_id = ? ORDER BY updated_at DESC LIMIT 1').get('weixin', peer) as { conversation_id: string } | undefined;
  const say = async (id: string, prompt: string, accountId: 'bot-a' | 'bot-b' = 'bot-a', peer = 'alice@im.wechat') => {
    const before = weixin!.messages.length;
    weixin!.send(accountId, peer, prompt);
    await until(async () => weixin!.messages.slice(before).some(item => item.accountId === accountId && item.to === peer && item.success && item.content.trim().length > 0), id, 180000);
    const answer = weixin!.messages.slice(before).filter(item => item.accountId === accountId && item.to === peer && item.success).map(item => item.content).join('\n');
    const session = route(peer); assert(session, 'The production channel must create the conversation');
    observedConversations.add(session.conversation_id);
    const state = await api(`/api/sessions/${session.conversation_id}?include=transcriptRows`);
    const calls = JSON.stringify(state.transcriptRows ?? []);
    assert(!/"name":"(?:exec_command|write_file|apply_patch)"/.test(calls), 'No storage bypass');
    report.weixinTurns ??= []; report.weixinTurns.push({ id, conversationId: session.conversation_id });
    return { answer, conversationId: session.conversation_id };
  };
  const pending = async (id: string, url: string, accountId: 'bot-a' | 'bot-b' = 'bot-a', peer = 'alice@im.wechat') => {
    const previousReads = testServers!.calls.length;
    const turn = await say(id, `连接这个资料服务 ${url}，并查询资料里的标记码。需要授权或密钥时请给安全入口。`, accountId, peer);
    const goals = observer.prepare("SELECT payload FROM durable_state WHERE namespace = 'mcp.conversation-setup' ORDER BY rowid DESC").all() as Array<{ payload: string }>;
    const goal = goals.map(row => JSON.parse(row.payload)).find(item => item.conversationId === turn.conversationId && item.url === url);
    assert(goal, 'The real agent must propose a setup');
    await cases(id, { originalIdentity: goal.channel.accountId === accountId && goal.channel.peerId === peer, approvalRequired: goal.phase === 'approval_required',
      trustedLink: turn.answer.includes(`${base}/#/mcp-setup/${goal.id}`), noProbeBeforeApproval: testServers!.calls.length === previousReads });
    return { ...turn, goal };
  };
  const open = async (goal: any) => {
    await page.goto(`${base}/#/mcp-setup/${goal.id}`);
    await page.getByRole('button', { name: /^(允许这次连接|Approve this connection)$/ }).waitFor();
    assert.equal(await page.getByText('Let xopc understand your work', { exact: true }).count(), 0, 'Credential pages must not require unrelated onboarding');
    await page.getByText(`${goal.channel.accountId} / ${goal.channel.peerId}`, { exact: true }).waitFor();
    await page.getByRole('button', { name: /^(允许这次连接|Approve this connection)$/ }).click();
  };
  const resumed = async (id: string, request: any, service: 'token' | 'oauth') => {
    const code = testServers!.codes[service];
    await until(async () => weixin!.messages.some(item => item.success && item.accountId === request.goal.channel.accountId && item.to === request.goal.channel.peerId && item.content.includes(code)), id);
    const state = await api(`/api/sessions/${request.conversationId}?include=transcriptRows`);
    const rows = observer.prepare('SELECT conversation_id FROM session_inputs WHERE client_message_id = ?').all(`mcp-setup:${request.goal.id}`) as Array<{ conversation_id: string }>;
    await cases(id, { realSourceRead: testServers!.calls.some(call => call.service === service && call.account === 'fixture-reader'),
      resultInOriginalTranscript: JSON.stringify(state).includes(code), onlyOriginalConversation: rows.length === 1 && rows[0].conversation_id === request.conversationId,
      onlyOriginalPeer: weixin!.messages.filter(item => item.success && item.content.includes(code)).every(item => item.accountId === request.goal.channel.accountId && item.to === request.goal.channel.peerId),
      oneAutomaticReply: weixin!.messages.filter(item => item.success && item.content.includes(code)).length === 1 });
  };
  try {
    await until(async () => weixin!.polls > 1, 'real Weixin monitor polls');
    if (recordDemo) {
      const startedAtMs = Date.now();
      report.scope = 'Recorded real-model production Weixin adapter flow, displayed in the original conversation in the product Web console; local ilink/MCP/OAuth services, not official WeChat or phone footage. Representative demo, not the full acceptance matrix.';
      report.chapters = [];
      const chapter = (title: string) => report.chapters.push({ title, offsetMs: Date.now() - startedAtMs });
      const showChat = async (id: string) => {
        await page.goto(`${base}/#/chat/${id}`);
        for (let attempt = 0; attempt < 4; attempt++) {
          await delay(1000);
          for (const name of ['Maybe later, keep using my current model', 'Skip for now', '以后再说，继续使用当前模型', '暂时跳过']) {
            const choice = page.getByRole('button', { name, exact: true });
            if (await choice.isVisible()) { await choice.click(); await delay(500); }
          }
        }
        if (!page.url().includes(id)) await page.goto(`${base}/#/chat/${id}`);
        // Reload the observer so a channel run completed in another tab is not hidden by cached history.
        await page.reload();
        await page.locator('[role="textbox"][contenteditable="true"]').first().waitFor();
        assert.equal(await page.getByText('Let xopc understand your work', { exact: true }).isVisible(), false);
        await delay(4500);
      };
      chapter('微信原会话：对话安装并使用 Skill');
      const skill = await say('demo-weixin-skill', `安装这个周报能力 ${artifactUrl}，全局可用。装好后整理苹果120元、香蕉80元、苹果50元，给出总额和金额最高的商品。`);
      await showChat(skill.conversationId);
      await cases('demo-weixin-skill', { installed: installed(), actualSummary: /250/.test(skill.answer) && /170/.test(skill.answer) });
      chapter('从原私聊发起 Token MCP 连接');
      const tokenRequest = await pending('demo-weixin-token-request', testServers!.tokenUrl);
      await showChat(tokenRequest.conversationId);
      chapter('安全页面：owner 核准服务和原私聊');
      await page.goto(`${base}/#/mcp-setup/${tokenRequest.goal.id}`); await delay(4000);
      await open(tokenRequest.goal);
      await page.locator('#mcp-setup-token').waitFor(); await delay(3000);
      chapter('安全输入：错误密钥拒绝，正确密钥始终掩码');
      await page.locator('#mcp-setup-token').fill(`wrong-${testServers!.token}`); await delay(2000);
      await page.getByRole('button', { name: /^(保存并连接|Save and connect)$/ }).click();
      await page.getByRole('alert').filter({ hasText: /未接受|未被接受|rejected/ }).waitFor(); await delay(3000);
      assert.equal(await page.locator('#mcp-setup-token').inputValue(), '');
      assert.equal(await page.locator('#mcp-setup-token').getAttribute('type'), 'password');
      await page.locator('#mcp-setup-token').fill(testServers!.token); await delay(2500);
      await page.getByRole('button', { name: /^(保存并连接|Save and connect)$/ }).click();
      await resumed('demo-weixin-token-resume', tokenRequest, 'token'); await delay(3000);
      chapter('Token 完成：无需继续，实际结果自动回原会话');
      await showChat(tokenRequest.conversationId);
      chapter('原私聊发起 OAuth 连接');
      const oauthRequest = await pending('demo-weixin-oauth-request', testServers!.oauthUrl);
      await showChat(oauthRequest.conversationId);
      await open(oauthRequest.goal);
      const signIn = page.getByRole('link', { name: /^(继续登录|Continue sign-in)$/ });
      await signIn.waitFor(); await delay(3500);
      const authorization = new URL((await signIn.getAttribute('href'))!);
      assert.equal(authorization.searchParams.get('redirect_uri'), `${base}/mcp-setup/callback/${oauthRequest.goal.id}`);
      chapter('OAuth：真实服务授权页面与 Gateway 回调');
      // Record the actual cross-origin popup separately; Chromium can omit its frames from the opener video.
      const popupStartMs = Date.now() - startedAtMs;
      const popupPromise = page.context().waitForEvent('page');
      await signIn.click(); const popup = await popupPromise;
      const popupVideo = popup.video();
      await popup.bringToFront();
      await popup.getByRole('button', { name: 'Allow connection', exact: true }).waitFor();
      await popup.screenshot({ path: join(evidence, 'demo-oauth-consent.png'), fullPage: true }); await delay(6000);
      const callback = popup.waitForResponse(response => new URL(response.url()).pathname === `/mcp-setup/callback/${oauthRequest.goal.id}`);
      await popup.getByRole('button', { name: 'Allow connection', exact: true }).click();
      assert.equal((await callback).status(), 303);
      await popup.waitForURL(/#\/mcp-setup\//); await delay(3000);
      await popup.close();
      const popupPath = join(evidence, 'oauth-authorization.webm');
      await popupVideo!.saveAs(popupPath);
      report.oauthRecording = { startMs: popupStartMs, endMs: Date.now() - startedAtMs, path: popupPath };
      await page.bringToFront();
      await resumed('demo-weixin-oauth-resume', oauthRequest, 'oauth'); await delay(4500);
      chapter('OAuth 完成：原会话自动续跑、实际业务结果已投递');
      await showChat(oauthRequest.conversationId);
      const transcript = JSON.stringify(await api(`/api/sessions/${oauthRequest.conversationId}?include=transcriptRows`));
      await cases('demo-weixin-secret-isolation', { noPlaintextSecretInConversation: ![...testServers!.sensitive].some(secret => transcript.includes(secret)),
        noSecretInWeixinMessages: ![...testServers!.sensitive].some(secret => weixin!.messages.some(item => item.content.includes(secret))) });
      report.recordingDurationMs = Date.now() - startedAtMs;
      return;
    }
    const ordinary = await say('weixin-ordinary', '给我一句周报开头，不要安装或创建任何任务。');
    await cases('weixin-ordinary', { replyDelivered: Boolean(ordinary.answer), noInstall: !installed() });
    const skill = await say('weixin-skill', `安装这个周报能力 ${artifactUrl}，全局可用。装好后整理苹果120元、香蕉80元、苹果50元，给出总额和金额最高的商品。`);
    await cases('weixin-skill', { installed: installed(), total: /250/.test(skill.answer), realSummary: /170/.test(skill.answer) && /苹果/.test(skill.answer) });
    const tokenRequest = await pending('weixin-token-request', testServers!.tokenUrl);
    assert.equal((await fetch(`${base}/api/mcp/setup/${tokenRequest.goal.id}`)).status, 401);
    await page.goto(`${base}/#/mcp-setup/${tokenRequest.goal.id}`);
    const anonymous = await browser!.newContext({ viewport: { width: 390, height: 844 } });
    const anonymousPage = await anonymous.newPage();
    await anonymousPage.goto(`${base}/#/mcp-setup/${tokenRequest.goal.id}`);
    await anonymousPage.getByPlaceholder(/Token or password|Token 或 Password/).waitFor();
    assert.equal(await anonymousPage.locator('#mcp-setup-token').count(), 0);
    await anonymous.close();
    await cases('weixin-owner-approval-view', { ownerRequired: !(await page.locator('#mcp-setup-token').count()), noCredentialsBeforeApproval: !Object.values(await configuredServers()).some((server: any) => server.url === testServers!.tokenUrl) });
    await open(tokenRequest.goal);
    await page.locator('#mcp-setup-token').waitFor();
    await stopGateway(); launch(); await ready(); await page.reload();
    await page.locator('#mcp-setup-token').waitFor();
    await page.locator('#mcp-setup-token').fill(`wrong-${testServers!.token}`);
    await page.getByRole('button', { name: /^(保存并连接|Save and connect)$/ }).click();
    await page.getByRole('alert').filter({ hasText: /未接受|未被接受|rejected/ }).waitFor();
    await cases('weixin-wrong-token', { inputCleared: await page.locator('#mcp-setup-token').inputValue() === '', noRead: !testServers!.calls.some(call => call.service === 'token') });
    await page.locator('#mcp-setup-token').fill(testServers!.token);
    assert.equal(await page.locator('#mcp-setup-token').getAttribute('type'), 'password');
    await page.getByRole('button', { name: /^(保存并连接|Save and connect)$/ }).click();
    await resumed('weixin-token-automatic-resume', tokenRequest, 'token');
    const oauthRequest = await pending('weixin-oauth-request', testServers!.oauthUrl, 'bot-b', 'bob@im.wechat');
    weixin!.blockMessagesContaining(testServers!.codes.oauth);
    await open(oauthRequest.goal);
    const signIn = page.getByRole('link', { name: /^(继续登录|Continue sign-in)$/ });
    await signIn.waitFor();
    const authorization = new URL((await signIn.getAttribute('href'))!);
    await cases('weixin-oauth-mobile-redirect', { gatewayCallback: authorization.searchParams.get('redirect_uri') === `${base}/mcp-setup/callback/${oauthRequest.goal.id}` });
    const badCallback = await fetch(`${base}/mcp-setup/callback/${oauthRequest.goal.id}?code=bad&state=wrong`, { redirect: 'manual' });
    assert.equal(badCallback.status, 400);
    const popupPromise = page.context().waitForEvent('page'); await signIn.click(); const popup = await popupPromise;
    await popup.route('**/api/mcp/setup/**', route => route.abort());
    await page.goto('about:blank');
    const callback = popup.waitForResponse(response => new URL(response.url()).pathname === `/mcp-setup/callback/${oauthRequest.goal.id}`);
    await popup.getByRole('button', { name: 'Allow connection', exact: true }).click();
    assert.equal((await callback).status(), 303); await popup.close();
    await until(async () => testServers!.calls.some(call => call.service === 'oauth'), 'host resumes without an open setup page');
    await cases('weixin-oauth-host-completion', { realReadWithoutBrowserAdvance: testServers!.calls.some(call => call.service === 'oauth') });
    await page.goto(`${base}/#/mcp-setup/${oauthRequest.goal.id}`);
    await page.getByRole('button', { name: /^(重试发送结果|Retry result delivery)$/ }).waitFor({ timeout: 120000 });
    const reads = testServers!.calls.filter(call => call.service === 'oauth').length;
    await cases('weixin-result-delivery-failure', { realReadCompleted: reads === 1, failedSendRecorded: weixin!.messages.some(item => !item.success && item.content.includes(testServers!.codes.oauth)) });
    weixin!.allowMessages();
    await page.getByRole('button', { name: /^(重试发送结果|Retry result delivery)$/ }).click();
    await resumed('weixin-oauth-automatic-resume', oauthRequest, 'oauth');
    await cases('weixin-result-delivery-retry', { noNewSourceRead: testServers!.calls.filter(call => call.service === 'oauth').length === reads,
      noExtraUserContinue: report.weixinTurns.length === 4 });
    const denied = await pending('weixin-oauth-denied-request', deniedServers!.oauthUrl);
    await open(denied.goal);
    const deniedPopupPromise = page.context().waitForEvent('page');
    await page.getByRole('link', { name: /^(继续登录|Continue sign-in)$/ }).click();
    const deniedPopup = await deniedPopupPromise;
    await deniedPopup.getByRole('button', { name: 'Deny', exact: true }).click();
    await deniedPopup.waitForURL(/#\/mcp-setup\//); await deniedPopup.close();
    await page.getByRole('alert').first().waitFor();
    await cases('weixin-oauth-denied', { noRemoteGrant: deniedServers!.grants === 0, noRead: deniedServers!.calls.length === 0,
      noConfig: !Object.values(await configuredServers()).some((server: any) => server.url === deniedServers!.oauthUrl),
      noResume: !(observer.prepare('SELECT 1 FROM session_inputs WHERE client_message_id=?').get(`mcp-setup:${denied.goal.id}`)) });
    const cancellation = await say('weixin-cancel-request', `只连接这个新的资料服务 ${testServers!.plainUrl}，先给我安全入口。`);
    const pendingGoal = JSON.parse((observer.prepare("SELECT payload FROM durable_state WHERE namespace='mcp.conversation-setup' ORDER BY rowid DESC LIMIT 1").get() as any).payload);
    await say('weixin-cancel', '取消刚才这次连接请求，不再继续，也不读取资料。');
    await page.goto(`${base}/#/mcp-setup/${pendingGoal.id}`);
    await page.getByText(/^(此连接请求已取消。|This connection request was cancelled\.)$/).waitFor();
    await cases('weixin-cancel-no-revival', { originalConversation: cancellation.conversationId === tokenRequest.conversationId, noConfig: !Object.values(await configuredServers()).some((server: any) => server.url === testServers!.plainUrl), noRead: !testServers!.calls.some(call => call.service === 'plain') });
    const disabled = await say('weixin-skill-disable', '停用周报能力，保留文件。');
    await cases('weixin-skill-disable', { disabled: await enabled() === false, keptFiles: installed(), replyDelivered: Boolean(disabled.answer) });
    const reenabled = await say('weixin-skill-enable', '重新启用周报能力，汇总橙子30元、梨20元。');
    await cases('weixin-skill-enable', { enabled: await enabled() === true, actualResult: /50/.test(reenabled.answer) });
    const reminderMarker = `微信喝水-${randomUUID().slice(0, 8)}`;
    await say('weixin-reminder-create', `60秒后只提醒我一次“${reminderMarker}”，在当前微信私聊通知我，不要现在试运行。任务名“微信喝水”。`);
    const reminder = (await api('/api/automations')).automations.find((item: any) => item.name === '微信喝水');
    await cases('weixin-reminder-create', { once: reminder?.trigger.schedule.kind === 'once', enabled: reminder?.enabled === true,
      originalIdentity: reminder?.delivery.destinations.some((item: any) => item.kind === 'weixin' && item.conversationId === tokenRequest.conversationId) });
    await stopGateway(); launch(); await ready();
    await until(async () => weixin!.messages.some(item => item.success && item.content.includes(reminderMarker) && item.content.includes('succeeded')), 'real scheduled Weixin reminder after restart', 150000);
    const reminderRuns = (await api(`/api/automation-runs?automationId=${reminder.id}`)).runs;
    const reminderDeliveries = (await api(`/api/automation-deliveries?runId=${reminderRuns[0].id}`)).items;
    await cases('weixin-reminder-actual-delivery', { scheduledOnce: reminderRuns.length === 1 && reminderRuns[0].manual === false && reminderRuns[0].status === 'succeeded',
      deliveryAcknowledged: reminderDeliveries.some((item: any) => item.kind === 'weixin' && item.status === 'delivered'),
      originalPeer: weixin!.messages.filter(item => item.success && item.content.includes('succeeded') && item.content.includes(reminderMarker)).every(item => item.accountId === 'bot-a' && item.to === 'alice@im.wechat') });
    await say('weixin-reminder-delete', '删除刚才的微信喝水定时任务，其他任务不动。');
    await cases('weixin-reminder-delete', { removed: !(await api('/api/automations')).automations.some((item: any) => item.id === reminder.id) });
    const snapshot = async () => JSON.stringify({ installed: installed(), enabled: await enabled(), servers: await configuredServers(),
      automations: (await api('/api/automations')).automations.map((item: any) => item.id).sort(), reads: testServers!.calls.length });
    const baseline = await snapshot();
    const prompts = ['帮我写一句周报开头，只给一句。', '解释 Skill 是什么，不做配置。', 'MCP 和普通 API 有什么区别？只解释。',
      '每天整理销售有什么好处？不要安排任务。', '把“本周完成销售分析”改得自然一点。', '给出苹果10元和梨20元的总额，不安装工具。',
      '我暂时不想装新能力，给一句建议即可。', '如何判断技能是否适合我？不要执行操作。', '把“本周销售汇总”翻译成英文，只翻译。',
      '我以后可能需要提醒，今天不要创建任务。', 'Suggest two report titles. Do not create anything.', 'Explain skills in one sentence. No configuration changes.',
      'Translate “销售汇总” into English. Just the translation.', 'Give me a short report checklist, without installing anything.',
      'What is a timezone? Do not schedule anything.', 'Summarize: We sold apples and pears. One sentence only.',
      'I might want a reminder someday. Do not create one.', 'What should I consider before connecting a service? Advice only.',
      'Rewrite: Sales improved this week. Do not save a document.', 'Explain disabling versus uninstalling. Do not change anything.'];
    for (const [index, prompt] of prompts.entries()) { await say(`weixin-negative-${index + 1}`, prompt); await cases(`weixin-negative-${index + 1}`, { noConfigurationMutation: await snapshot() === baseline }); }
    const transcriptText = (await Promise.all([...observedConversations].map(id => api(`/api/sessions/${id}?include=transcriptRows`)))).map(value => JSON.stringify(value)).join('');
    const outboundText = weixin!.messages.map(item => item.content).join('');
    const configText = await readFile(join(root, 'xopc.json'), 'utf8');
    const diagnostic = logs + await readFile(join(root, 'pi/mcp.log'), 'utf8').catch(() => '');
    const secrets = [...testServers!.sensitive, ...Object.values(weixin!.tokens)];
    await cases('weixin-secret-isolation', { noSecretsInTranscript: !secrets.some(secret => transcriptText.includes(secret)), noSecretsInOutbound: !secrets.some(secret => outboundText.includes(secret)), noPlaintextConfig: ![...testServers!.sensitive].some(secret => configText.includes(secret)), noSecretsInLogs: !secrets.some(secret => diagnostic.includes(secret)) });
  } finally { observer.close(); }
}

async function verifyOnlineDiscovery() {
  report.scope = 'Live internet discovery from a service name, real model and production secure form. No service Token is supplied; official authenticated connection is outside this check.';
  await send('online-mcd-name', '帮我连接中国麦当劳的官方服务，只连接，不查询账号资料。', async (_answer) => ({ visibleReply: true }), true);
  const observer = new DatabaseSync(join(root, 'xopc.db'), { readOnly: true });
  try {
    const row = observer.prepare("SELECT payload FROM durable_state WHERE namespace='mcp.conversation-setup' AND json_extract(payload,'$.conversationId')=? ORDER BY rowid DESC LIMIT 1").get(conversationId!) as { payload: string } | undefined;
    assert(row, 'Live search did not produce a setup plan'); const goal = JSON.parse(row.payload);
    assert.equal(goal.url.replace(/\/$/, ''), 'https://mcp.mcd.cn'); assert.equal(goal.authentication, 'bearer');
    assert.equal(goal.objective, 'connect_only'); assert(goal.sources?.some((source: any) => /^https:\/\/(open\.mcd\.cn|github\.com\/M-China\/mcd-mcp-server|raw\.githubusercontent\.com\/M-China\/mcd-mcp-server\/main\/README\.md)(?:\/|$)/.test(source.url)));
    await page.locator(`a[data-xopc-link-kind="internal-route"][href="#/mcp-setup/${goal.id}"]`).click();
    const approval = page.getByRole('button', { name: /^(允许这次连接|Approve this connection)$/ });
    if (await approval.isVisible()) await approval.click();
    await page.locator('input[type="password"]').first().waitFor();
    await page.screenshot({ path: join(evidence, 'online-mcd-secure-input.png'), fullPage: true });
    report.cases.push({ id: 'online-mcd-secure-input', passed: true, checks: { officialSource: true, documentedEndpoint: true, bearerForm: true, noCredentialSupplied: true }, sources: goal.sources.map((source: any) => source.url) });
  } finally { observer.close(); }
}

async function verifyNameDiscovery() {
  report.scope = 'Name-only discovery through the production search provider, actual reference reads, real model, secure UI and native MCP. Virtual public .example origins route to independent real localhost servers through an explicit test-only Node dispatcher; production SSRF/DNS guards are tested separately. Not official external service authorization.';
  const fixtures = discoveryFixtures!, servers = testServers!;
  const observer = new DatabaseSync(join(root, 'xopc.db'), { readOnly: true });
  const goal = () => JSON.parse((observer.prepare("SELECT payload FROM durable_state WHERE namespace='mcp.conversation-setup' AND json_extract(payload,'$.conversationId')=? ORDER BY rowid DESC LIMIT 1").get(conversationId!) as { payload: string }).payload);
  const check = async (id: string, checks: Record<string, boolean>) => { report.cases.push({ id, checks, passed: Object.values(checks).every(Boolean) }); console.log(JSON.stringify({ id, checks })); assert(Object.values(checks).every(Boolean), id); };
  await page.context().route('https://auth-fixture.example/**', async route => {
    const request = route.request(), incoming = new URL(request.url());
    const response = await fetch(`${servers.networkRoutes['https://auth-fixture.example']}${incoming.pathname}${incoming.search}`, { method: request.method(), headers: request.headers(), body: request.postData() ?? undefined, redirect: 'manual' });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  try {
    const rounds = Number(process.env.XOPC_CONFIGURATION_E2E_NAME_ROUNDS ?? '1'); assert.equal(rounds, 1, 'Repeat this command in separate processes for independent acceptance rounds');
    const allKinds = ['public-only', 'public', 'token', 'unknown', 'header', 'legacy', 'stdio', 'oauth', 'package'];
    const kinds = process.env.XOPC_CONFIGURATION_E2E_NAME_KINDS?.split(',') ?? allKinds;
    assert(kinds.length && kinds.every(kind => allKinds.includes(kind)));
    report.acceptanceSubset = kinds.length === allKinds.length ? 'full name-flow matrix' : `diagnostic subset: ${kinds.join(',')}`;
    for (let round = 1; round <= rounds; round++) {
      for (const kind of kinds) {
        const key = kind;
        const beforeCalls = servers.calls.length, beforeStdio = await fixtures.stdioReads(), beforePackage = await fixtures.packageReads(), beforeSearch = fixtures.searchLog.length;
        await send(`name-${round}-${kind}`, kind === 'public-only' ? `帮我连接${fixtures.names[key]}，只连接，不读取我的资料。` : `帮我连接${fixtures.names[key]}并查询我资料中的标记码。`, async () => ({ searchedFromName: fixtures.searchLog.length > beforeSearch, noReadBeforeApproval: servers.calls.length === beforeCalls && await fixtures.stdioReads() === beforeStdio && await fixtures.packageReads() === beforePackage }), true);
        const current = goal();
        const local = kind === 'stdio' || kind === 'package';
        assert.equal(current.phase, 'approval_required'); assert(current.sources?.length && current.publicOnly !== false || local);
        assert.equal(current.transport ?? 'streamable-http', local ? 'stdio' : kind === 'legacy' ? 'sse' : 'streamable-http');
        if (!local) assert.equal(current.url, kind === 'public-only' ? servers.publicOnlyUrl : kind === 'public' ? servers.publicUrl : kind === 'token' ? servers.tokenExplicitUrl : kind === 'unknown' ? servers.tokenUrl : kind === 'header' ? servers.headerUrl : kind === 'legacy' ? servers.legacyUrl : servers.oauthUrl);
        else assert(current.execution?.command && current.secretFields?.some((f: any) => f.name === 'FIXTURE_ACCESS_KEY'));
        assert.equal(current.objective, kind === 'public-only' ? 'connect_only' : 'complete_task');
        await page.locator(`a[data-xopc-link-kind="internal-route"][href="#/mcp-setup/${current.id}"]`).click();
        await page.getByRole('button', { name: /^(允许这次连接|Approve this connection)$/ }).click();
        if (['token', 'unknown', 'header', 'legacy', 'stdio', 'package'].includes(kind)) {
          await page.locator('input[type="password"]').first().waitFor();
          if (round === 1 && kind === 'unknown') { await stopGateway(); launch(); await ready(); await page.reload(); await page.locator('input[type="password"]').first().waitFor(); }
          const snapshot = await api(`/api/mcp/setup/${current.id}`);
          if (kind === 'unknown') assert.equal(snapshot.phase, 'auth_unknown');
          for (const field of snapshot.secretFields?.length ? snapshot.secretFields : [{ id: 'token', name: 'Authorization' }]) await page.locator(`#mcp-setup-${field.id}`).fill(field.name === 'X-Tenant-Token' ? servers.tenantToken : servers.token);
          await page.getByRole('button', { name: /^(保存并连接|Save and connect)$/ }).click();
        } else if (kind === 'oauth') {
          const popupPromise = page.context().waitForEvent('page'); await page.getByRole('link', { name: /^(继续登录|Continue sign-in)$/ }).click();
          const popup = await popupPromise; await popup.getByRole('button', { name: 'Allow connection', exact: true }).click();
        }
        await page.waitForURL(new RegExp(`#/chat/${conversationId}`), { timeout: 120000 });
        const expectedCode = kind === 'stdio' ? fixtures.stdioCode : kind === 'package' ? fixtures.packageCode : servers.codes[(kind === 'unknown' ? 'token' : key) as keyof typeof servers.codes];
        await until(async () => {
          const state = await api(`/api/sessions/${conversationId}/input-state`); const h = await api(`/api/sessions/${conversationId}?include=transcriptRows`);
          return !state.activeRunId && !state.inputs?.some((i: any) => ['queued', 'running'].includes(i.status)) && goal().resumed && (kind === 'public-only' || JSON.stringify(h.messages).includes(expectedCode));
        }, `name ${kind} original objective`);
        const history = JSON.stringify(await api(`/api/sessions/${conversationId}?include=transcriptRows`)), stored = JSON.stringify(await configuredServers());
        await check(`name-${round}-${kind}-verified`, { sameConversation: page.url().includes(conversationId!), ready: goal().phase === 'ready', actualExpectedRead: kind === 'public-only' ? servers.calls.length === beforeCalls : kind === 'package' ? await fixtures.packageReads() > beforePackage && fixtures.packageDownloads > 0 : kind === 'stdio' ? await fixtures.stdioReads() > beforeStdio : servers.calls.slice(beforeCalls).some(call => call.code === expectedCode), noSecretInTranscript: ![...servers.sensitive].some(secret => history.includes(secret)), noSecretInConfig: ![...servers.sensitive].some(secret => stored.includes(secret)) });
        await page.screenshot({ path: join(evidence, `name-${round}-${kind}-verified.png`), fullPage: true });
      }
    }
    const diagnostic = logs + await readFile(join(root, 'pi/mcp.log'), 'utf8').catch(() => '');
    report.inferenceFailures = modelRequests.filter(request => request.status !== 200).map(request => ({ status: request.status, elapsedMs: request.elapsedMs }));
    await check('name-flow-secret-isolation', { noSecretInLogs: ![...servers.sensitive].some(secret => diagnostic.includes(secret)), realModel: modelRequests.filter(r => r.status === 200).length >= kinds.length });
  } finally { observer.close(); }
}

launch();
try {
  await ready();
  if (stage === 'mcp') assert.equal((await fetch(base + '/api/mcp/setup/not-found')).status, 401, 'MCP setup must require authentication through the real Gateway');
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base + '/#/chat/new');
  await page.getByPlaceholder(/Token or password|Token 或 Password/).fill(token);
  await page.getByRole('button', { name: /^Connect$|^连接$/ }).click();
  for (const name of ['Maybe later, keep using my current model', 'Skip for now', '以后再说，继续使用当前模型', '暂时跳过']) {
    try { await page.getByRole('button', { name, exact: true }).click({ timeout: 1000 }); } catch { /* Optional onboarding. */ }
  }
  if (onlineFlow) {
    await verifyOnlineDiscovery();
  } else if (nameFlow) {
    await verifyNameDiscovery();
  } else if (stage === 'weixin') {
    if (recordDemo) {
      recordingContext = await browser.newContext({ storageState: await page.context().storageState(),
        viewport: { width: 1280, height: 900 }, recordVideo: { dir: join(evidence, 'recording'), size: { width: 1280, height: 900 } } });
      await page.close(); page = await recordingContext.newPage(); recordedVideo = page.video();
      await page.goto(base + '/#/chat/new');
    }
    await verifyWeixin();
  } else if (recordDemo) {
    // Start a new recording after Gateway sign-in, so the gateway credential is never filmed.
    recordingContext = await browser.newContext({ storageState: await page.context().storageState(),
      viewport: { width: 390, height: 844 }, recordVideo: { dir: join(evidence, 'recording'), size: { width: 390, height: 844 } } });
    await page.close();
    page = await recordingContext.newPage(); recordedVideo = page.video();
    const startedAtMs = Date.now();
    report.scope = 'Recorded representative showcase, not the full phase acceptance matrix';
    report.chapters = [];
    const chapter = (title: string) => report.chapters.push({ title, offsetMs: Date.now() - startedAtMs });
    chapter('Skill：对话安装、使用与停启');
    await send('install-and-use', `请安装这个周报能力 ${artifactUrl}，全局可用。装好后整理销售数据：苹果120元、香蕉80元、苹果50元，给出总额和金额最高的商品，并告诉我以后怎么用。`, async answer => ({ installed: installed(), actualTotal: /250/.test(answer), actualLeader: /苹果/.test(answer) && /170/.test(answer) }), true);
    await send('demo-disable', '先停用刚才的周报能力，保留文件。', async () => ({ disabled: await enabled() === false, filesPreserved: installed() }));
    await send('demo-enable', '重新启用周报能力，整理橙子30元、梨20元。', async answer => ({ enabled: await enabled() === true, actualResult: /50/.test(answer) }));
    chapter('MCP：安全输入 Token，回原聊天继续读取');
    await send('demo-token-start', `连接这个资料服务 ${testServers!.tokenUrl}，名称 demo_token，读出资料里的标记码。需要密钥时给我安全输入入口。`, async () => ({ noReadBeforeCredential: !testServers!.calls.some(call => call.service === 'token') }), true);
    await openSetupInteraction(); await delay(3000);
    assert.equal(await page.locator('#mcp-setup-token').getAttribute('type'), 'password');
    await page.locator('#mcp-setup-token').fill(testServers!.token); await delay(2000);
    await page.getByRole('button', { name: /^(保存并连接|Save and connect)$/ }).click();
    await until(async () => testServers!.calls.some(call => call.service === 'token'), 'recorded actual MCP read', 120000);
    await continuation('demo-token-resume', 'token'); await delay(5000);
    chapter('自动化：存草稿、真实试跑、启用一次性提醒');
    const taskName = '演示喝水提醒', marker = '演示完成，记得喝水';
    const named = async () => (await api('/api/automations')).automations.find((item: any) => item.name === taskName);
    const history = async () => (await api(`/api/automation-runs?automationId=${encodeURIComponent((await named()).id)}`)).runs;
    await send('demo-automation-draft', `保存“${taskName}”为草稿：每天北京时间九点由 Ada 提醒我“${marker}”，在这里通知我。先不要启用，也不要运行。`, async () => ({ disabled: (await named())?.enabled === false, notRun: (await history()).length === 0 }), true);
    await send('demo-automation-trial', '现在实际试运行一次刚才的提醒，等执行完成后告诉我真实结果，仍不要启用。', async answer => ({ actualRun: (await history())[0]?.status === 'succeeded', actualResult: answer.includes(marker), disabled: (await named())?.enabled === false }));
    await send('demo-automation-enable', '把这个提醒改成30秒后只自动执行一次并启用，其他内容保留，不要再次手动运行。', async () => ({ once: (await named())?.trigger.schedule.kind === 'once', enabled: (await named())?.enabled === true, noExtraTrial: (await history()).length === 1 }));
    await until(async () => (await history()).some((run: any) => !run.manual && run.status === 'succeeded' && run.summary?.includes(marker)), 'recorded real scheduled execution', 120000);
    chapter('真实定时执行完成，查看结果与通知');
    await send('demo-automation-result', '刚才的一次性提醒真正执行了吗？告诉我实际结果和查看入口，不要再次执行。', async answer => ({ actualResult: answer.includes(marker), exactlyOneScheduledRun: (await history()).filter((run: any) => !run.manual).length === 1 }));
    await page.locator('button[aria-controls="app-sidebar"]:visible').first().click();
    await page.getByRole('button', { name: /^(Notifications|通知)(?: \(\d+\))?$/ }).click();
    await page.getByRole('link').filter({ hasText: marker }).first().waitFor(); await delay(5000);
    report.cases.push({ id: 'demo-actual-notification', checks: { actualUserInbox: true }, passed: true });
    report.recordingDurationMs = Date.now() - startedAtMs;
  } else if (stage === 'automations') {
    report.fixture = 'Real isolated scheduler, model and production Web Chat. Two pre-existing assistants; no management API writes by the test.';
    const baseline = new Set((await api('/api/automations')).automations.map((a: any) => a.id));
    const userAutomations = async () => (await api('/api/automations')).automations.filter((a: any) => !baseline.has(a.id));
    const named = async (name: string) => (await userAutomations()).find((a: any) => a.name === name);
    const history = async (id: string) => (await api(`/api/automation-runs?automationId=${encodeURIComponent(id)}`)).runs;
    const taskName = '销售小结';
    let taskId = '', originalAction = '';
    await send('automation-draft', '帮我保存一个名为“销售小结”的定时任务草稿：每天北京时间上午九点，把苹果10元和梨20元相加并告诉我总额。由 Ada 执行，结果在这里查看。先不要启用，也不要运行。', async () => {
      const task = await named(taskName); taskId = task?.id ?? ''; originalAction = JSON.stringify(task?.action);
      return { oneDraft: (await userAutomations()).length === 1, disabled: task?.enabled === false,
        cron: task?.trigger.schedule.expr === '0 9 * * *', timezone: task?.trigger.schedule.tz === 'Asia/Shanghai',
        currentAgent: !task?.action.agentId || task.action.agentId === 'main', notRun: taskId && (await history(taskId)).length === 0 } as Record<string, boolean>;
    }, true);
    await page.locator(`a[href*="automation=${taskId}"]`).first().click();
    const management = page.getByRole('dialog');
    await management.waitFor();
    assert.equal(await management.getByRole('textbox').first().inputValue(), taskName);
    report.cases.push({ id: 'automation-management-link', checks: { actualManagementDialog: true, selectedObject: true }, passed: true });
    await management.getByRole('button', { name: /^(Cancel|取消)$/ }).click();
    await send('automation-update-time', '把这个销售小结改为每天上午十点半，北京时间，仍是草稿，其他内容不变。', async () => {
      const task = await named(taskName);
      // The action may repeat the schedule; permit that exact time correction only.
      const preservedAction = [originalAction, originalAction.replaceAll('上午九点', '上午十点半')].includes(JSON.stringify(task?.action));
      return { sameObject: task?.id === taskId, cron: task?.trigger.schedule.expr === '30 10 * * *', timezone: task?.trigger.schedule.tz === 'Asia/Shanghai', preservedAction, disabled: task?.enabled === false };
    });
    await send('automation-change-assistant', '把这个任务交给 Reviewer 助手执行，只改执行助手，不改时间和任务内容。', async () => ({ selectedAgent: (await named(taskName))?.action.agentId === 'reviewer', sameObject: (await named(taskName))?.id === taskId, noDuplicate: (await userAutomations()).length === 1 }));
    await send('automation-restore-assistant', '再交回给 Ada 执行，其他设置保留。', async () => ({ selectedAgent: (await named(taskName))?.action.agentId === 'main', sameObject: (await named(taskName))?.id === taskId }));
    await stopGateway(); launch(); await ready(); await page.reload();
    await send('automation-restart-draft', '刷新后确认刚才的草稿还在，告诉我当前时间规则和启用状态，不要修改或运行。', async answer => ({ persistent: (await named(taskName))?.id === taskId, stillDisabled: (await named(taskName))?.enabled === false, noRun: (await history(taskId)).length === 0, accurate: /10:30|10：30|十点半/.test(answer) }));
    await send('automation-trial', '请现在实际试运行一次销售小结，等真正执行完成后告诉我算出的总额；仍不要启用定时。', async answer => {
      const runs = await history(taskId); return { oneActualRun: runs.length === 1 && runs[0].manual === true, completed: runs[0]?.status === 'succeeded', actualResult: /30/.test(runs[0]?.summary ?? '') && /30/.test(answer), stillDisabled: (await named(taskName))?.enabled === false };
    });
    await send('automation-enable', '试跑完成后，请启用现有销售小结的每天十点半安排，告诉我下次时间和时区，不要新建或再次试跑。', async answer => {
      const task = await named(taskName), next = task?.state.nextRunAtMs;
      return { sameObject: task?.id === taskId, enabled: task?.enabled === true, futureRun: next > Date.now(), correctTime: Boolean(next) && new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }).format(next) === '10:30', timezoneFeedback: /北京|Shanghai|UTC\+8|GMT\+8/.test(answer), noExtraTrial: (await history(taskId)).length === 1 };
    });
    await send('automation-pause', '先暂停销售小结的后续定时安排，保留任务和历史结果。', async () => ({ paused: (await named(taskName))?.enabled === false, historyPreserved: (await history(taskId)).length === 1 }));
    await send('automation-resume', '恢复刚才暂停的安排，沿用原来的内容和时间，不再试跑。', async () => ({ resumed: (await named(taskName))?.enabled === true, sameObject: (await named(taskName))?.id === taskId, noDuplicate: (await userAutomations()).length === 1, noExtraTrial: (await history(taskId)).length === 1 }));
    await send('automation-delete', '不再需要销售小结，请删除这个定时任务，其他任务保持原样。', async () => ({ deleted: !(await named(taskName)), othersPreserved: (await api('/api/automations')).automations.every((a: any) => baseline.has(a.id)) }));
    await send('automation-one-off-answer', '算一下 3 加 4，只给这一次答案，不创建任何任务。', async answer => ({ result: /7/.test(answer), noSchedule: (await userAutomations()).length === 0 }), true);
    const marker = `喝水提醒-${randomUUID().slice(0, 8)}`, scheduledAt = Date.now();
    let scheduledId = '';
    await send('automation-once', `请在90秒后只提醒我一次“${marker}”，由 Ada 执行，在这里查看，不要现在试运行。任务名叫“喝水提醒”。`, async () => {
      const task = await named('喝水提醒'); scheduledId = task?.id ?? '';
      const at = Date.parse(task?.trigger.schedule.at ?? '');
      return { once: task?.trigger.schedule.kind === 'once', enabled: task?.enabled === true, notifiesOnSuccess: task?.delivery.notificationPolicy === 'all', actualFuture: at > scheduledAt + 45000 && at < scheduledAt + 150000, noManualRun: scheduledId && (await history(scheduledId)).length === 0 } as Record<string, boolean>;
    }, true);
    await stopGateway(); launch(); await ready(); await page.reload();
    await until(async () => (await history(scheduledId)).some((r: any) => ['succeeded', 'failed', 'timeout'].includes(r.status)), 'actual scheduled run after Gateway restart', 180000);
    await delay(5000);
    const scheduledRuns = await history(scheduledId);
    const scheduleChecks = { oneScheduledExecution: scheduledRuns.length === 1 && scheduledRuns[0].manual === false,
      actualResult: scheduledRuns[0]?.status === 'succeeded' && scheduledRuns[0].summary?.includes(marker), noReplacement: (await named('喝水提醒'))?.id === scheduledId };
    report.cases.push({ id: 'automation-actual-scheduled-run', checks: scheduleChecks, passed: Object.values(scheduleChecks).every(Boolean) });
    assert(Object.values(scheduleChecks).every(Boolean), 'Real scheduler execution');
    await until(async () => (await api(`/api/notifications?since=${scheduledAt}`)).items.some((n: any) => n.target?.runId === scheduledRuns[0].id), 'user reminder notification', 15000);
    const deliveryRows = (await api(`/api/automation-deliveries?runId=${scheduledRuns[0].id}`)).items;
    assert(deliveryRows.some((row: any) => row.kind === 'gateway_event' && row.status === 'delivered'), 'Actual result delivery receipt');
    await page.locator('button[aria-controls="app-sidebar"]:visible').first().click();
    await page.getByRole('button', { name: /^(Notifications|通知)(?: \(\d+\))?$/ }).click();
    await page.getByRole('link').filter({ hasText: marker }).first().waitFor();
    report.cases.push({ id: 'automation-reminder-delivery', checks: { notificationPersisted: true, gatewayDeliveryCompleted: true, actualUserInbox: true }, passed: true });
    await page.screenshot({ path: join(evidence, 'automation-reminder-delivery.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('button[aria-controls="app-sidebar"]:visible').first().waitFor();
    await send('automation-read-result', '刚才的喝水提醒有没有真正执行？把实际结果和查看入口给我，不要再次执行。', async answer => ({ actualResult: answer.includes(marker), noExtraRun: (await history(scheduledId)).length === 1 }));
    await send('automation-delete-english', 'Delete the local 喝水提醒 automation. Do not create a replacement.', async () => ({ removed: !(await named('喝水提醒')), noneRemain: (await userAutomations()).length === 0 }));
    await send('automation-missing-source', '请每天北京时间九点总结我的 Gmail。必须先核对账号并真正读取成功；如果当前没有可用的 Gmail 连接或读邮件工具，就说明阻塞，不创建或启用任务，也不要找别的来源代替。', async answer => ({ noUnverifiedSchedule: (await userAutomations()).length === 0, honestBlocker: /未连接|不可用|缺少|没有|无法|未配置|未发现/.test(answer) }), true);
    await send('automation-connect-source', `连接这个资料服务 ${testServers!.publicUrl}，名称 test_schedule，并查询它的标记码。`, async answer => ({ connected: (await configuredNamedServer('test_schedule'))?.url === testServers!.publicUrl, actualRead: testServers!.calls.some(call => call.service === 'public'), actualResult: answer.includes(testServers!.codes.public) }), true);
    let pinnedId = '', sourceId = '';
    const verifiedSourceRun = async (run: any) => {
      if (run?.status !== 'succeeded' || !run.conversationId) return false;
      const transcript = JSON.stringify(await api(`/api/sessions/${run.conversationId}?include=transcriptRows`));
      return testServers!.calls.some(call => call.service === 'public' && call.atMs >= run.startedAtMs && call.atMs <= run.endedAtMs
        && run.summary?.includes(call.code) && transcript.includes(call.code));
    };
    await send('automation-source-trial-before-enable', '请每天北京时间九点读取刚才那个 test_schedule 资料服务里的标记码，任务名“资料日报”，由 Ada 执行，结果在这里查看。每次运行沿用同一任务会话，方便查看前后记录。先试一次，确认真实读到了再启用；不要换来源，也别用历史记录顶替。', async answer => {
      const task = await named('资料日报'); pinnedId = task?.id ?? ''; sourceId = task?.action.mcpSourceId ?? '';
      const runs = pinnedId ? await history(pinnedId) : [];
      return { oneObject: (await userAutomations()).length === 1, sourcePinned: Boolean(sourceId), continuousContext: task?.conversationMode === 'continuous', enabledAfterTrial: task?.enabled === true,
        oneTrial: runs.length === 1 && runs[0].manual === true, realSourceResult: await verifiedSourceRun(runs[0]), reportsActualResult: Boolean(runs[0]?.summary) && testServers!.calls.some(call => runs[0]?.summary?.includes(call.code) && answer.includes(call.code)) };
    });
    const beforeFailureReads = testServers!.calls.length;
    await send('automation-source-disabled-failure', '暂时停用 test_schedule 连接，不改资料日报的安排。然后实际试运行一次这个任务，查看并告诉我真实状态；不要换其他服务或用旧结果当作成功。', async answer => {
      const runs = await history(pinnedId); return { sourceDisabled: (await configuredNamedServer('test_schedule'))?.enabled === false,
        sameBinding: (await named('资料日报'))?.action.mcpSourceId === sourceId, actualFailedRun: runs.length === 2 && runs[0].status === 'failed',
        noFallbackRead: testServers!.calls.length === beforeFailureReads, honestFailure: /失败|停用|不可用|disabled|failed/i.test(answer) };
    });
    await send('automation-source-recovery', '重新启用 test_schedule，再实际试运行一次原来的资料日报，成功后保留现有安排，不要新建任务。', async () => {
      const task = await named('资料日报'), runs = await history(pinnedId);
      return { sameObject: task?.id === pinnedId, sameBinding: task?.action.mcpSourceId === sourceId, oneNewTrial: runs.length === 3,
        actualFreshRead: await verifiedSourceRun(runs[0]) };
    });
    await send('automation-source-schedule-once', '把资料日报改为90秒后只自动执行一次，其余设置保持不变，不要现在手动运行。', async () => {
      const task = await named('资料日报'); return { sameObject: task?.id === pinnedId, sameBinding: task?.action.mcpSourceId === sourceId,
        enabled: task?.enabled === true, once: task?.trigger.schedule.kind === 'once', noExtraTrial: (await history(pinnedId)).length === 3 };
    });
    await stopGateway(); launch(); await ready(); await page.reload();
    await until(async () => (await history(pinnedId)).some((r: any) => r.manual === false && ['succeeded', 'failed', 'timeout'].includes(r.status)), 'real pinned-source scheduled execution', 180000);
    const sourceRuns = await history(pinnedId);
    const pinnedScheduleChecks = { oneScheduledRun: sourceRuns.filter((r: any) => !r.manual).length === 1, freshBoundResult: await verifiedSourceRun(sourceRuns.find((r: any) => !r.manual)), sameBinding: (await named('资料日报'))?.action.mcpSourceId === sourceId };
    report.cases.push({ id: 'automation-source-actual-scheduled-run', checks: pinnedScheduleChecks, passed: Object.values(pinnedScheduleChecks).every(Boolean) });
    assert(Object.values(pinnedScheduleChecks).every(Boolean), 'Scheduled execution must use the pinned source');
    await send('automation-source-cleanup', '请删除资料日报这个定时任务，保留资料服务连接。', async () => ({ removed: !(await named('资料日报')), connectionPreserved: Boolean(await configuredNamedServer('test_schedule')) }));
    await negativeChecks();
  } else if (token403Only) {
    report.scope = 'First-time Token HTTP 403 recovery and explicit Bearer setup, real model and production Web Chat; not the complete MCP acceptance matrix or official McDonald service.';
    report.fixture = 'Independent real HTTP MCP server: HTTP 403 JSON without WWW-Authenticate until the correct Bearer Token is supplied.';
    const verify = async (id: string, checks: Record<string, boolean>) => {
      report.cases.push({ id, checks, passed: Object.values(checks).every(Boolean) });
      console.log(JSON.stringify({ id, checks })); assert(Object.values(checks).every(Boolean), id);
    };
    await send('mcp-403-auto-start', `连接资料服务 ${testServers!.tokenUrl}，命名 test_403，读取资料中的标记码。目前不知道认证方式，请先自动探测；如果服务拒绝访问，请给我产品里的配置入口。`, async () => ({ notPublished: !(await configuredServers()).test_403, noRead: testServers!.calls.length === 0 }), true);
    const observer = new DatabaseSync(join(root, 'xopc.db'), { readOnly: true });
    try {
      const goal = () => JSON.parse((observer.prepare("SELECT payload FROM durable_state WHERE namespace='mcp.conversation-setup' AND json_extract(payload,'$.conversationId')=? ORDER BY rowid DESC LIMIT 1").get(conversationId!) as { payload: string }).payload);
      assert.equal(goal().phase, 'blocked'); assert.equal(goal().errorCode, 'access_denied'); assert(!goal().tokenProvider);
      const setupId = goal().id;
      // Click the actual assistant link, not a generated test URL or action-bar fallback.
      await page.locator(`a[data-xopc-link-kind="internal-route"][href="#/mcp-setup/${setupId}"]`).click();
      await page.locator('#mcp-setup-token').waitFor();
      await verify('mcp-403-first-token-form', { actualChatLink: true, passwordInput: await page.locator('#mcp-setup-token').getAttribute('type') === 'password', noFalseRejectedToken: !(await page.getByText(/密钥未被接受|This key was rejected/).count()), refusedWithoutCredential: testServers!.refusals.some(r => r.status === 403 && !r.hadCredential) });
      await stopGateway(); launch(); await ready(); await page.reload();
      await page.locator('#mcp-setup-token').waitFor();
      await page.locator('#mcp-setup-token').fill(`wrong-${testServers!.token}`);
      await page.getByRole('button', { name: /^(保存并连接|Save and connect)$/ }).click();
      await page.getByRole('alert').filter({ hasText: /未接受|未被接受|rejected/ }).waitFor();
      await verify('mcp-403-wrong-token-after-restart', { sameSetup: goal().id === setupId, notPublished: !(await configuredServers()).test_403, noRead: testServers!.calls.length === 0, inputCleared: await page.locator('#mcp-setup-token').inputValue() === '', credentialRejected: goal().errorCode === 'credential_rejected' });
      await page.locator('#mcp-setup-token').fill(testServers!.token);
      await page.getByRole('button', { name: /^(保存并连接|Save and connect)$/ }).click();
      await continuation('mcp-403-original-chat-resume', 'token');
      await verify('mcp-403-resumed-once', { sameSetup: goal().id === setupId, queuedOnce: Number((observer.prepare('SELECT COUNT(*) AS total FROM session_inputs WHERE client_message_id=?').get(`mcp-setup:${setupId}`) as { total: number }).total) === 1 });
      const refusalsBeforeExplicit = testServers!.refusals.length, readsBeforeExplicit = testServers!.calls.length;
      await send('mcp-bearer-explicit-start', `连接资料服务 ${testServers!.tokenExplicitUrl}，命名 test_bearer，读取标记码。接入说明明确要求 Authorization: Bearer MCP Token，请直接引导安全配置 Token，不要先尝试无凭据连接。`, async () => ({ notPublished: !(await configuredServers()).test_bearer }), true);
      assert.equal(goal().authentication, 'bearer'); assert.equal(goal().phase, 'token_required');
      const explicitId = goal().id;
      await page.locator(`a[data-xopc-link-kind="internal-route"][href="#/mcp-setup/${explicitId}"]`).click();
      await page.locator('#mcp-setup-token').waitFor();
      await page.locator('#mcp-setup-token').fill(testServers!.token);
      await page.getByRole('button', { name: /^(保存并连接|Save and connect)$/ }).click();
      await continuation('mcp-bearer-original-chat-resume', 'token');
      await verify('mcp-bearer-no-unauthenticated-probe', { noNewRefusal: testServers!.refusals.length === refusalsBeforeExplicit, freshRealRead: testServers!.calls.length > readsBeforeExplicit });
      const diagnostic = logs + await readFile(join(root, 'pi/mcp.log'), 'utf8').catch(() => '');
      await verify('mcp-403-secret-isolation', { noSecretsInLogs: ![...testServers!.sensitive].some(secret => diagnostic.includes(secret)), noSecretsInUrls: ![...testServers!.sensitive].some(secret => page.url().includes(secret)), realModel: modelRequests.filter(r => r.status === 200).length >= kinds.length });
    } finally { observer.close(); }
  } else if (stage === 'mcp' && process.env.XOPC_CONFIGURATION_E2E_MCP_SMOKE === '1') {
    report.scope = 'Diagnostic smoke only; not a complete phase acceptance';
    if (process.env.XOPC_CONFIGURATION_E2E_MCP_RELOAD === '1') {
      await send('smoke-connect', `连接 ${testServers!.publicUrl}，名称 test_reload，只连接，不读取资料。`, async () => ({ configured: Boolean((await configuredServers()).test_reload) }), true);
      await send('smoke-disable', '停用 test_reload，保留配置。', async () => ({ disabled: (await configuredServers()).test_reload?.enabled === false }));
      await send('smoke-enable', '启用 test_reload，不读取资料。', async () => ({ enabled: (await configuredServers()).test_reload?.enabled === true }));
      await send('smoke-remove', '移除 test_reload 的本地配置。', async () => ({ removed: !(await configuredServers()).test_reload }));
    }
    for (const [index, prompt] of [
      `Connect ${testServers!.tokenUrl} as test_cancel and read my verification code.`,
      `连接这个资料服务 ${testServers!.oauthUrl}，名称用 test_denied。`,
    ].entries()) {
      await send(`smoke-${index}`, prompt, async () => ({ notPublished: Object.keys(await configuredServers()).length === 0 }), true);
      await openSetupInteraction();
      await page.locator('details:not([open]) > summary').click();
      await page.getByRole('button', { name: /^(取消连接|Cancel connection)$/ }).click();
      await page.getByText(/^(此连接请求已取消。|This connection request was cancelled\.)$/).waitFor();
    }
  } else if (stage === 'mcp') {
    report.fixture = 'Independent real HTTP MCP, bearer Token and OAuth authorization-code servers with PKCE. Real model and production Web Chat; no management API writes by the test.';
    await send('mcp-public', `帮我连接这个测试资料服务 ${testServers!.publicUrl}，名称用 test_public，并查询我资料中的标记码。`, async answer => ({ configured: Boolean((await configuredServers()).test_public), actualRead: testServers!.calls.some(call => call.service === 'public'), uniqueResult: answer.includes(testServers!.codes.public) }), true);
    await send('mcp-token-start', `帮我连接这个资料服务 ${testServers!.tokenUrl}，名称用 test_token，并读出我资料中的标记码。需要密钥时请提供安全输入入口。`, async answer => ({ notPublishedBeforeCredential: !(await configuredServers()).test_token, noReadWithoutCredential: !testServers!.calls.some(call => call.service === 'token'), noContinuePrompt: !/回复.{0,12}(继续|完成授权)/.test(answer) }), true);
    await stopGateway(); launch(); await ready(); await page.reload();
    await openSetupInteraction();
    await page.locator('#mcp-setup-token').fill(`wrong-${testServers!.token}`);
    await page.getByRole('button', { name: /^(保存并连接|Save and connect)$/ }).click();
    await page.getByRole('alert').filter({ hasText: /未接受|未被接受|rejected/ }).waitFor();
    const wrongTokenChecks = { notPublished: !(await configuredServers()).test_token, noRead: !testServers!.calls.some(call => call.service === 'token'), clearedInput: await page.locator('#mcp-setup-token').inputValue() === '' };
    report.cases.push({ id: 'mcp-wrong-token', checks: wrongTokenChecks, passed: Object.values(wrongTokenChecks).every(Boolean) });
    assert(Object.values(wrongTokenChecks).every(Boolean));
    await page.locator('#mcp-setup-token').fill(testServers!.token);
    await page.getByRole('button', { name: /^(保存并连接|Save and connect)$/ }).click();
    await continuation('mcp-token-resume-after-restart', 'token');
    await send('mcp-oauth-start', `连接资料服务 ${testServers!.oauthUrl}，名称用 test_oauth，并查询我资料中的标记码。`, async answer => ({ notPublishedBeforeAuthorization: !(await configuredServers()).test_oauth, noContinuePrompt: !/回复.{0,12}(继续|完成授权)/.test(answer) }), true);
    await openSetupInteraction();
    const popupPromise = page.context().waitForEvent('page');
    await page.getByRole('link', { name: /^(继续登录|Continue sign-in)$/ }).click();
    const popup = await popupPromise; await popup.waitForLoadState('domcontentloaded');
    await popup.getByRole('button', { name: 'Allow connection', exact: true }).click();
    await continuation('mcp-oauth-resume', 'oauth'); await popup.close();
    await send('mcp-disable', '暂时停用 test_public 连接，保留配置，不改其他服务。', async () => ({ disabled: (await configuredServers()).test_public?.enabled === false, otherConnectionsPreserved: Boolean((await configuredServers()).test_token && (await configuredServers()).test_oauth) }));
    await send('mcp-enable', '重新启用 test_public 连接，不需要再次读取资料。', async () => ({ enabled: (await configuredServers()).test_public?.enabled === true }));
    await send('mcp-remove', '断开并移除 test_token 的本地配置，其他服务保留。', async answer => ({ removed: !(await configuredServers()).test_token, otherConnectionPreserved: Boolean((await configuredServers()).test_oauth), distinguishesRemoteAuthorization: /本地|远端|授权/.test(answer) }));
    await send('mcp-denied-start', `连接这个资料服务 ${testServers!.oauthUrl}，名称用 test_denied。`, async () => ({ notPublished: !(await configuredServers()).test_denied }), true);
    await openSetupInteraction();
    const deniedPopupPromise = page.context().waitForEvent('page');
    await page.getByRole('link', { name: /^(继续登录|Continue sign-in)$/ }).click();
    const deniedPopup = await deniedPopupPromise;
    await deniedPopup.getByRole('button', { name: 'Deny', exact: true }).click();
    await until(async () => await page.getByRole('alert').count() > 0, 'authorization refusal is visible', 90000);
    await page.locator('details:not([open]) > summary').click();
    await page.getByRole('button', { name: /^(取消连接|Cancel connection)$/ }).click();
    await page.getByText(/^(此连接请求已取消。|This connection request was cancelled\.)$/).waitFor();
    await deniedPopup.close();
    report.cases.push({ id: 'mcp-oauth-denied', checks: { noConfiguration: !(await configuredServers()).test_denied, oneGrantedAuthorization: testServers!.grants === 1 }, passed: !(await configuredServers()).test_denied && testServers!.grants === 1 });
    assert(report.cases.at(-1).passed, 'Denied authorization must not publish configuration');
    const publicReads = testServers!.calls.filter(call => call.service === 'public').length;
    await send('mcp-connect-only', `Please connect ${testServers!.publicUrl} as test_no_read. Only connect it; do not read any account data.`, async () => ({ configured: Boolean((await configuredServers()).test_no_read), noUnrequestedRead: testServers!.calls.filter(call => call.service === 'public').length === publicReads }), true);
    const unchangedConfig = JSON.stringify(await configuredServers());
    await send('mcp-inspect-only', 'List my configured MCP services and their enabled states. Do not change anything.', async answer => ({ unchanged: JSON.stringify(await configuredServers()) === unchangedConfig, names: /test_public/.test(answer) && /test_oauth/.test(answer) }), true);
    await send('mcp-unavailable', `Connect ${testServers!.publicUrl.replace('/public', '/missing')} as test_missing. If unavailable, explain the blocker; do not keep retrying.`, async answer => ({ notPublished: !(await configuredServers()).test_missing, honestFailure: /失败|无法|不可|404|unavailable|failed|not.found/i.test(answer) }), true);
    await send('mcp-cancel-start', `Connect ${testServers!.tokenUrl} as test_cancel and read my verification code.`, async () => ({ noConfiguration: !(await configuredServers()).test_cancel }), true);
    await openSetupInteraction();
    await page.locator('#mcp-setup-token').waitFor();
    await page.locator('details:not([open]) > summary').click();
    await page.getByRole('button', { name: /^(取消连接|Cancel connection)$/ }).click();
    await page.getByText(/^(此连接请求已取消。|This connection request was cancelled\.)$/).waitFor();
    await page.getByRole('button', { name: /^(返回对话|Return to chat)$/ }).click();
    await send('mcp-cancel-status', 'I cancelled that connection. Check its status without reconnecting.', async answer => ({ noConfiguration: !(await configuredServers()).test_cancel, cancelled: /取消|cancel|未连接|未配置|not.connected|not.configured/i.test(answer) }));
    await send('mcp-remove-english', 'Remove the local test_no_read connection. Keep the other services.', async () => ({ removed: !(await configuredServers()).test_no_read, othersPreserved: Boolean((await configuredServers()).test_public && (await configuredServers()).test_oauth) }));
    await send('mcp-ordinary-unnamed-service', `帮我连上这个新的资料服务 ${testServers!.plainUrl}，然后告诉我它记录的标记码。`, async answer => ({ configured: Object.values(await configuredServers()).some((server: any) => server.url === testServers!.plainUrl), correctSource: testServers!.calls.some(call => call.service === 'plain'), actualResult: answer.includes(testServers!.codes.plain) }), true);
    await negativeChecks();
    for (const id of observedConversations) {
      const history = JSON.stringify(await api(`/api/sessions/${id}?include=transcriptRows`));
      assert(![...testServers!.sensitive].some(secret => history.includes(secret)), 'A credential appeared in a stored conversation');
    }
    async function logTexts(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      const texts: string[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) texts.push(...await logTexts(join(dir, entry.name)));
        else if (entry.isFile()) texts.push(await readFile(join(dir, entry.name), 'utf8'));
      }
      return texts;
    }
    const diagnosticText = [logs, await readFile(join(root, 'pi/mcp.log'), 'utf8').catch(() => ''), ...await logTexts(join(root, 'logs')), ...await logTexts(join(root, 'traces'))].join('\n');
    assert(![...testServers!.sensitive].some(secret => diagnosticText.includes(secret)), 'A credential appeared in diagnostic logs');
    const finalConfig = JSON.stringify(await configuredServers());
    assert(![...testServers!.sensitive].some(secret => finalConfig.includes(secret)), 'A credential appeared in persisted configuration');
    report.secretIsolation = { modelRequests: true, allConversations: true, persistedConfig: true, diagnosticLogs: true };
  } else if (process.env.XOPC_CONFIGURATION_E2E_PUBLIC_INSTALL === '1') {
    report.fixture = 'Live public marketplace discovery and package download; no video scripts or generation';
    const publicSkill = async () => (await readdir(join(root, 'skills')).catch(() => []))
      .find(name => /hyperframes/i.test(name) && existsSync(join(root, 'skills', name, 'SKILL.md')));
    await send('public-install', '我想用 HyperFrames 做视频，请帮我从技能市场安装 HyperFrames 到全局。先不要生成视频，也不要运行它的脚本，装好后告诉我怎么开始使用。', async answer => ({ publicPackageInstalled: Boolean(await publicSkill()), namedCapability: /hyperframes/i.test(answer) }), true);
    await send('public-uninstall', '请卸载刚才安装的 HyperFrames，其他能力保持不变。', async () => ({ publicPackageRemoved: !await publicSkill() }));
  } else {
  const initialAutomations = (await api('/api/automations')).automations.map((item: any) => item.id).sort();
  await send('recommend-only', '只告诉我周报怎么写，不要安装能力，也不要创建任务。', async () => ({ noInstall: !installed(), noAutomation: JSON.stringify((await api('/api/automations')).automations.map((item: any) => item.id).sort()) === JSON.stringify(initialAutomations) }));
  await send('install-and-use', `请安装这个周报能力 ${artifactUrl}，全局可用。装好后整理这些销售数据：苹果120元、香蕉80元、苹果50元。给出总额和销量金额最高的商品，并告诉我以后怎么用。`, async answer => ({ installed: installed(), total: /250/.test(answer), leadingProduct: /苹果/.test(answer) && /170/.test(answer), usage: /以后|下次|可以|例如/.test(answer) }));
  await page.locator('a[href*="capabilities/skills"]').last().click();
  await page.waitForURL(/#\/capabilities\/skills/);
  await page.getByText('weekly-report', { exact: true }).first().waitFor();
  report.cases.push({ id: 'management-link', checks: { opensActualManagementPage: true, installedSkillVisible: true }, passed: true });
  await page.screenshot({ path: join(evidence, 'management-link.png'), fullPage: true });
  await page.goto(`${base}/#/chat/${conversationId}`);
  await send('disable', '先停用刚才的周报能力，保留安装文件，以后我可能还会用。', async () => ({ disabled: await enabled() === false, filesPreserved: installed() }));
  await stopGateway(); launch(); await ready();
  await page.reload();
  await send('inspect-disabled', '刷新后再帮我确认，周报能力现在是没安装，还是已经停用了？只查看，不修改。', async answer => ({ disabled: await enabled() === false, accurate: /停用|禁用|关闭/.test(answer), noReinstall: installed() }));
  await send('enable-and-use', '重新启用周报能力，整理橙子30元、梨20元。', async answer => ({ enabled: await enabled() === true, result: /50/.test(answer) }));
  await send('already-installed', '周报能力是否已经安装并可用？如果已可用就不要重复安装。', async answer => ({ installed: installed(), accurate: /已安装|可用/.test(answer) }));
  await send('uninstall', '以后不需要周报能力了，请卸载，只移除刚才安装的这个能力。', async () => ({ removed: !installed() }));
  await send('verify-uninstalled', 'Please check whether the weekly report skill is still installed. Do not reinstall it.', async answer => ({ removed: !installed(), accurate: /not installed|no longer installed|not found|uninstalled|未安装|已卸载|不存在/i.test(answer) }));
  await send('broken-source', `请安装这个能力 ${artifactUrl.replace('weekly-report.zip', 'missing.zip')}。如果下载失败，告诉我原因，其他已装能力不要动。`, async answer => ({ noInstall: !installed(), honestFailure: /失败|无法|404|不可|不存在/.test(answer) }));
  await send('bundled-uninstall', '请卸载内置的 pdf 能力，其他能力不动。', async answer => ({ bundledPreserved: existsSync(join(root, 'bundled-skills/documents/pdf/SKILL.md')), honestRestriction: /不能|无法|不可|不支持|内置.*(保留|管理)/.test(answer) }));
  await send('marketplace-search', '帮我在技能市场找适合整理 PDF 的能力，推荐两个，说明来源。只推荐，不要安装。', async answer => ({ noInstall: !installed(), provenance: /ClawHub|SkillHub|Store|来源|市场/i.test(answer) }), true);
  await negativeChecks();
  }
  if (stage !== 'weixin' && !recordDemo && !token403Only && !nameFlow && !onlineFlow && process.env.XOPC_CONFIGURATION_E2E_MCP_SMOKE !== '1') {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await page.locator('[role="textbox"][contenteditable="true"]').first().waitFor();
    const layout = { desktopEditorVisible: await page.locator('[role="textbox"][contenteditable="true"]').first().isVisible(),
      noHorizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1) };
    report.cases.push({ id: 'desktop-chat-layout', checks: layout, passed: Object.values(layout).every(Boolean) });
    await page.screenshot({ path: join(evidence, 'desktop-chat-layout.png'), fullPage: true });
    assert(Object.values(layout).every(Boolean), 'Desktop chat layout');
    if (stage === 'mcp') {
      const originalChat = report.cases.find((item: any) => item.id === 'mcp-public').conversationId;
      await page.goto(`${base}/#/chat/${originalChat}`);
      await page.locator('a[href*="capabilities/connectors"]').last().click();
      await page.waitForURL(/#\/capabilities\/connectors/);
      await page.getByText('test_public', { exact: true }).first().waitFor();
      await page.reload();
      await page.getByText('test_public', { exact: true }).first().waitFor();
      report.cases.push({ id: 'mcp-management-link', checks: { actualConnectedServiceVisible: true, refreshWorks: true }, passed: true });
      await page.screenshot({ path: join(evidence, 'mcp-management-link.png'), fullPage: true });
    }
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1;
  await page!?.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  report.modelRequests = modelRequests;
  if (weixin) report.weixinMessages = weixin.messages.map(({ context: _context, ...message }) => message);
  await writeFile(join(evidence, 'result.json'), JSON.stringify(report, null, 2));
  await writeFile(join(evidence, 'gateway.private.log'), logs, { mode: 0o600 });
  if (recordedVideo) {
    await recordingContext!.close();
    const videoPath = join(evidence, 'conversation-configuration-demo.webm');
    await recordedVideo.saveAs(videoPath);
    report.video = videoPath;
    await writeFile(join(evidence, 'result.json'), JSON.stringify(report, null, 2));
  }
  await browser?.close();
  await stopGateway();
  proxy.closeAllConnections(); fixture.closeAllConnections();
  await Promise.all([new Promise<void>(done => proxy.close(() => done())), new Promise<void>(done => fixture.close(() => done()))]);
  await testServers?.close();
  await discoveryFixtures?.close();
  await deniedServers?.close();
  await weixin?.close();
  console.log(JSON.stringify({ passed: report.passed, evidence, error: report.error }));
}
process.exit(process.exitCode ?? 0);
