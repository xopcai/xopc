/** Conversation-only setup through the real App UI and XOPC Cloud GPT-5.6 Sol. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.env.XOPC_PHONE_REAL_MODEL, '1', 'Set XOPC_PHONE_REAL_MODEL=1 to operate the emulator and registered cloud test phone');
const originalEnv = { ...process.env };
const originalState = resolve(process.env.XOPC_STATE_DIR ?? join(process.env.HOME!, '.xopc'));
const credentials = resolve(process.env.XOPC_CREDENTIALS_DIR ?? join(originalState, 'credentials'));
const credentialPath = join(credentials, 'oauth/xopc-cloud.json');
const evidence = resolve(process.env.XOPC_PHONE_SETUP_EVIDENCE ?? '/tmp/xopc-conversational-setup-live');
await mkdir(evidence, { recursive: true });
async function blocked(reason: string, details: Record<string, unknown> = {}): Promise<never> {
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ ok: false, status: 'blocked', reason, ...details }, null, 2));
  console.log(JSON.stringify({ status: 'blocked', reason, evidence })); process.exit(2);
}
const adb = process.env.XOPC_PHONE_ADB_PATH ?? join(process.env.HOME!, 'Library/Android/sdk/platform-tools/adb');
const devices = JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', join(originalState, 'xopc.db'), "SELECT payload FROM durable_state WHERE namespace='phone.devices'"], { encoding: 'utf8' }) || '[]').map((row: any) => JSON.parse(row.payload));
const selectedCloud = devices.find((d: any) => d.name === (process.env.XOPC_PHONE_DEVICE_NAME ?? '阿里云测试手机') && d.enabled && d.connection?.kind === 'aliyun-adb');
if (!selectedCloud) await blocked('configured_test_phone_not_found');
const leases = JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', join(originalState, 'xopc.db'), "SELECT key,payload FROM durable_state WHERE namespace='phone.leases'"], { encoding: 'utf8' }) || '[]');
if (leases.some((row: any) => row.key === selectedCloud.serial && JSON.parse(row.payload).expiresAt > Date.now())) await blocked('test_phone_busy');
const { XopcCloudModelSource } = await import('../src/providers/xopc-cloud-model-source.js');
const catalog = await new XopcCloudModelSource().fetch();
if (catalog.status !== 'fetched') await blocked('phone_catalog_unavailable');
assert(catalog.status === 'fetched');
const phoneModels = catalog.models.filter(model => model.phoneUse);
const requestedModel = process.env.XOPC_PHONE_SETUP_MODEL?.replace(/^xopc-cloud\//, '');
const phoneModel = requestedModel ? phoneModels.find(model => model.id === requestedModel) : phoneModels.find(model => model.id === 'phone') ?? (phoneModels.length === 1 ? phoneModels[0] : undefined);
if (!phoneModel) await blocked('select_available_phone_model', { compatibleModelIds: phoneModels.map(model => model.id) });
const phoneModelRef = `xopc-cloud/${phoneModel.id}`;
const root = await mkdtemp(join(tmpdir(), 'xopc-phone-setup-live-'));
await mkdir(join(root, 'home'));
const modelRequests: Array<{ id: number; status?: number; elapsedMs?: number; configureSkill: boolean }> = [];
const proxy = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); body.model = 'openai-codex/gpt-5.6-sol';
    assert(modelRequests.length < 100, 'Guidance model request budget exceeded');
    const event = { id: modelRequests.length + 1, configureSkill: JSON.stringify(body.messages.filter((m: any) => m.role === 'system')).includes('configure-xopc') } as typeof modelRequests[number];
    modelRequests.push(event); const start = Date.now();
    if (JSON.parse(await readFile(credentialPath, 'utf8')).expiresAt <= Date.now() + 60_000) {
      const refresh = spawn(process.execPath, ['--import', 'tsx', '--input-type=module'], { cwd: resolve('.'), env: originalEnv, stdio: ['pipe', 'ignore', 'ignore'] });
      refresh.stdin.end("import { CredentialResolver } from './src/auth/credentials.ts'; await new CredentialResolver().resolveApiKey('xopc-cloud'); process.exit(0);");
      assert.equal((await once(refresh, 'exit'))[0], 0, 'Cloud credential refresh failed');
    }
    const { access } = JSON.parse(await readFile(credentialPath, 'utf8'));
    const response = await fetch('https://router.xopc.ai/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(150_000) });
    event.status = response.status; res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') ?? 'application/json' });
    if (response.body) for await (const chunk of response.body) { if (res.destroyed) break; res.write(chunk); }
    res.end(); event.elapsedMs = Date.now() - start;
  } catch { if (!res.headersSent) res.writeHead(502); res.end(JSON.stringify({ error: 'Real guidance request failed' })); }
});
proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
const modelAddress = proxy.address(); assert(modelAddress && typeof modelAddress !== 'string');
const probe = createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
const address = probe.address(); assert(address && typeof address !== 'string'); const port = address.port;
await new Promise<void>(done => probe.close(() => done()));
const base = `http://127.0.0.1:${port}`; const token = randomUUID(); const configPath = join(root, 'xopc.json');
Object.assign(process.env, { XOPC_STATE_DIR: root, XOPC_CONFIG: configPath, XOPC_CONFIG_PATH: configPath, XOPC_CREDENTIALS_DIR: credentials,
  XOPC_WORKSPACE: root, XOPC_MODELS_JSON: join(root, 'models.json'), PI_CODING_AGENT_DIR: join(root, 'pi'), XOPC_BUNDLED_SKILLS_ROOT: join(root, 'skills'),
  XOPC_BROWSER_EXT_BUNDLED_ROOT: join(root, 'browser-extension'), XOPC_UI_STATIC_ROOT: process.env.XOPC_PHONE_SETUP_UI_ROOT ?? resolve('dist/gateway/static/root'), XOPC_LOG_CONSOLE: 'false', XOPC_LOG_FILE: 'false', XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1' });
await writeFile(configPath, JSON.stringify({ gateway: { bind: 'loopback', port, auth: { mode: 'token', token } }, phone: { enabled: false, adbPath: adb }, browser: { enabled: false } }), { mode: 0o600 });
const modelRef = 'phone-setup-live/gpt-5.6-sol';
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { 'phone-setup-live': { baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`, api: 'openai-completions', apiKey: 'isolated-relay', models: [{ id: 'gpt-5.6-sol', name: 'XOPC Cloud GPT-5.6 Sol', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096 }] } } }), { mode: 0o600 });
const db = await import('../src/storage/sqlite/connection.js'); db.openXopcDatabase();
const { seedTestAgentCatalog } = await import('../src/agent-catalog/test-support.js');
const { AgentDefaultsSchema } = await import('../src/agent-config/schema.js');
const tools = ['xopc_use', 'tool_manual', 'skills_list', 'skill_view', 'phone_use', 'browser_use', 'clarify'];
seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: modelRef }, background: { primary: modelRef } }, runtime: { maxTurns: 32, timeoutMs: 300000, thinkingLevel: 'off' } }), agents: [{ id: 'main', enabled: true, workspace: root, profile: { name: 'Conversational setup acceptance', language: 'zh' }, skills: { mode: 'replace', include: ['configure-xopc'] }, toolAllowlist: tools, tools: Object.fromEntries(tools.map(name => [name, { mode: 'allow' }])) }] });
const { getModelCatalogStore } = await import('../src/providers/model-catalog-store.js');
const { ModelCatalogPersistence } = await import('../src/providers/model-catalog-persistence.js');
getModelCatalogStore().replaceSourceModels('xopc-cloud', catalog.source, catalog.models);
await new ModelCatalogPersistence().save(getModelCatalogStore().getSource('xopc-cloud')!);
const { PhoneRepository } = await import('../src/phone/repository.js');
const repository = new PhoneRepository();
const cloud = repository.save({ ...selectedCloud, name: selectedCloud.name, appAccess: 'selected', allowedApps: ['com.android.settings'] });
(new (await import('../src/agent-catalog/repository.js')).AgentCatalogRepository()).markProvisioned('main');
db.closeXopcDatabase();
await cp(resolve('skills'), join(root, 'skills'), { recursive: true });
await cp(resolve('packages/browser-ext'), join(root, 'browser-extension'), { recursive: true, filter: source => !source.includes('node_modules') && !source.includes('/src/') && !source.includes('/scripts/') });
let child: ReturnType<typeof spawn>; let logs = '';
function launch() { child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/bin.ts', 'gateway', '--port', String(port), '--no-hot-reload'], { cwd: resolve('.'), env: { ...process.env, HOME: join(root, 'home') }, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout!.on('data', c => { logs = (logs + c).slice(-200000); }); child.stderr!.on('data', c => { logs = (logs + c).slice(-200000); }); }
const request = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90000) });
  const result = await response.json() as any; assert(response.ok, `${path}: ${response.status} ${JSON.stringify(result)}`); return result.payload ?? result;
};
async function until<T>(check: () => Promise<T | undefined | false>, label: string, timeout = 300000): Promise<T> {
  const deadline = Date.now() + timeout; while (Date.now() < deadline) { assert(child.exitCode === null, `Gateway exited ${child.exitCode}`); const result = await check(); if (result) return result; await delay(750); } throw Error(`Timeout: ${label}`);
}
async function ready() { await until(async () => { try { const r = await fetch(base + '/api/health'); return r.ok && (await r.json() as any).ready ? true : undefined; } catch { return undefined; } }, 'Gateway ready', 90000); }
const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');
let browser: import('playwright-core').Browser | undefined;
let page: import('playwright-core').Page | undefined;
const results: any[] = [];
let conversationId: string | undefined;
const saved = () => request(`/api/sessions/${conversationId}?include=transcriptRows`);
async function noSetupUi() {
  assert.equal(await page!.locator('section[aria-label="Phone Use setup"], section[aria-label="Phone Use 配置"], section[aria-label="Browser Use setup"], section[aria-label="Browser Use 配置"]').count(), 0, 'Setup UI was embedded in chat');
  assert.equal(await page!.getByRole('button', { name: /Approve and start safe test|授权并开始安全验收|Enable Chrome and prepare files|Start demo test/ }).count(), 0, 'Setup action button was embedded in chat');
}
async function send(content: string, fresh = false) {
  if (fresh) {
    await page!.goto(`${base}/#/chat/new?skill=configure-xopc`);
    await page!.getByRole('textbox').first().waitFor();
  }
  const previous = conversationId ? (await saved()).transcriptRows?.length : 0;
  const editor = page!.locator('[role="textbox"][contenteditable="true"]').first();
  await editor.fill(content); await editor.press('Enter');
  await until(async () => {
    const match = /#\/chat\/([0-9a-f-]{36})/.exec(page!.url());
    if (!match) return undefined; conversationId = match[1];
    const state = await request(`/api/sessions/${conversationId}/input-state`);
    return state.activeRunId || state.inputs?.length ? true : undefined;
  }, 'UI submitted natural message', 60000);
  await until(async () => {
    const state = await request(`/api/sessions/${conversationId}/input-state`);
    const h = await saved(); const rows = h.transcriptRows ?? h.session?.transcriptRows ?? [];
    return !state.activeRunId && !state.inputs?.some((i: any) => ['queued', 'running'].includes(i.status)) && rows.length > (fresh ? 0 : previous ?? 0) ? true : undefined;
  }, 'natural guidance turn completed');
  await noSetupUi();
  const h = await saved(); await writeFile(join(evidence, `${conversationId}.private.json`), JSON.stringify(h), { mode: 0o600 });
  const rows = h.transcriptRows ?? h.session?.transcriptRows ?? [];
  const answer = rows.filter((r: any) => r.role === 'assistant').flatMap((r: any) => Array.isArray(r.content) ? r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text) : []).join('\n');
  console.log(JSON.stringify({ stage: 'turn', content, conversationId, answer: answer.slice(-2000) }));
  return rows;
}
const calls = (rows: any[]) => rows.flatMap(row => row.role === 'assistant' && Array.isArray(row.content) ? row.content.filter((b: any) => b.type === 'toolCall').map((b: any) => ({ name: b.name, args: b.arguments })) : []);
launch();
try {
  await ready();
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.goto(`${base}/#/chat/new?skill=configure-xopc`);
  await page.getByPlaceholder(/Token or password|Token 或 Password/).fill(token);
  await page.getByRole('button', { name: /^Connect$|^连接$/ }).click();
  for (const name of ['Maybe later, keep using my current model', 'Skip for now', '以后再说，继续使用当前模型', '暂时跳过']) { try { await page.getByRole('button', { name, exact: true }).click({ timeout: 1200 }); } catch {} }
  let rows: any[];
  if (process.env.XOPC_SETUP_LIVE_SCENE !== 'browser') {
  await send('帮我配置 Phone Use', true);
  rows = await send(`使用已经配置的阿里云测试手机；使用已登录的手机操作模型 ${phoneModelRef}。请自动完成能处理的配置和系统设置基础验收，允许发送这台测试手机的设置页截图并产生正常模型调用费用，不更改其他设置。`);
  const inspected = await request('/api/phone/setup', { conversationId, action: 'inspect' });
  assert(inspected.setup, 'No Phone setup was created');
  const phoneCalls = calls(rows).filter(c => c.name === 'xopc_use' && c.args.mode === 'phone_setup');
  assert(phoneCalls.some(c => c.args.command === 'configure'), 'Agent did not enable Phone automatically');
  assert(phoneCalls.some(c => c.args.command === 'source'), 'Agent did not select the source through the tool');
  assert(phoneCalls.some(c => c.args.command === 'begin_verification'), 'Agent did not begin testing without a setup UI');
  assert(phoneCalls.some(c => c.args.command === 'verification_report'), 'Agent did not inspect verification evidence');
  assert(inspected.setup.readiness.model.chatRef === modelRef, 'Phone setup changed the chat model');
  assert(phoneCalls.some(c => c.args.command === 'set_model'), 'Agent did not set the dedicated Phone route');
  assert(inspected.setup.checks.released, 'Phone control was not released');
  results.push({ scenario: 'phone', conversationId, state: inspected.setup.state, checks: inspected.setup.checks, error: inspected.setup.error, commands: phoneCalls.map(c => c.args.command), noEmbeddedConfigurationUi: true });
  await page.screenshot({ path: join(evidence, 'phone-chat.png'), fullPage: true });
  }
  if (process.env.XOPC_SETUP_LIVE_SCENE !== 'phone') {
  rows = await send('帮我配置 Browser Use，自动完成 Chrome 扩展和本机组件的准备。先不要打开 Chrome 或开始验收，准备好后告诉我手动加载扩展的步骤。', true);
  const inspectedBrowser = await request('/api/browser/setup', { conversationId, action: 'inspect' });
  const browserCalls = calls(rows).filter(c => c.name === 'xopc_use' && c.args.mode === 'browser_setup');
  assert(browserCalls.some(c => ['prepare', 'advance'].includes(c.args.command)), 'Agent did not prepare Browser automatically');
  assert(inspectedBrowser.installation.installed && inspectedBrowser.installation.nativeHostInstalled, 'Real Browser files/native host were not prepared');
  results.push({ scenario: 'browser', conversationId, installation: inspectedBrowser.installation, state: inspectedBrowser.setup?.state, commands: browserCalls.map(c => c.args.command), noEmbeddedConfigurationUi: true, userStep: 'load unpacked extension in Chrome' });
  await page.screenshot({ path: join(evidence, 'browser-chat.png'), fullPage: true });
  }
  const guidanceRequests = modelRequests.filter(r => r.configureSkill);
  assert(guidanceRequests.length > 0 && guidanceRequests.every(r => r.status === 200), 'Conversation guidance API failure');
  const fullPhonePass = results.filter(result => result.scenario === 'phone').every(result => result.state === 'completed' && Object.values(result.checks).every(Boolean));
  const browserNeedsManual = results.some(result => result.scenario === 'browser' && result.state !== 'completed');
  const status = !fullPhonePass ? 'blocked' : browserNeedsManual ? 'requires_manual_step' : 'passed';
  if (status !== 'passed') process.exitCode = 2;
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ ok: status === 'passed', status, chatModel: 'xopc-cloud/openai-codex/gpt-5.6-sol', phoneModelRef, results, modelRequests }, null, 2));
  console.log(JSON.stringify({ stage: status, evidence, results }));
} catch (error) {
  process.exitCode = 1; console.error(error instanceof Error ? error.message : 'Live verification failed');
  await page?.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
  if (page) await writeFile(join(evidence, 'failure.private.txt'), await page.locator('body').innerText().catch(() => ''), { mode: 0o600 });
  await writeFile(join(evidence, 'gateway.private.log'), logs, { mode: 0o600 });
  await writeFile(join(evidence, 'model-requests.json'), JSON.stringify(modelRequests, null, 2));
} finally {
  if (conversationId) { try { const value = await request('/api/phone/setup', { conversationId, action: 'inspect' }); if (value.setup?.attempt && !value.setup.attempt.released) await request('/api/phone/setup', { conversationId, setupId: value.setup.id, action: 'release' }); } catch {} }
  await browser?.close();
  if (child!.exitCode === null) { const exited = once(child!, 'exit'); child!.kill('SIGTERM'); await Promise.race([exited, delay(8000)]); if (child!.exitCode === null) child!.kill('SIGKILL'); }
  proxy.closeAllConnections(); await new Promise<void>(done => proxy.close(() => done())); db.closeXopcDatabase(); await rm(root, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
