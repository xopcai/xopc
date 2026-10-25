// Historical panel-based acceptance for d03530103; current setup uses verify-conversational-setup-live.mts.
// Real-model, production pairing + Realtime acceptance. All App and Chrome state is isolated.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { BrowserContext, Page } from 'playwright-core';
const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');
assert.equal(process.platform, 'darwin', 'This live acceptance currently covers macOS');
const nativePermissions = process.env.XOPC_BROWSER_NATIVE_PERMISSIONS === '1';
const recovery = process.env.XOPC_BROWSER_RECOVERY === '1';
const cloud = nativePermissions || recovery || process.env.XOPC_BROWSER_SETUP_CLOUD === '1';
const credentialEnv = { ...process.env };
const cloudCredentialPath = resolve(process.env.HOME!, '.xopc/credentials/oauth/xopc-cloud.json');
const pairingOnly = process.env.XOPC_BROWSER_PAIRING_ONLY === '1';
assert(pairingOnly || cloud || process.env.DASHSCOPE_API_KEY, 'DASHSCOPE_API_KEY is required for real-model acceptance');
const upstreamKey = process.env.DASHSCOPE_API_KEY;
const root = await mkdtemp(join(tmpdir(), 'xopc-browser-production-'));
const home = join(root, 'home'); await mkdir(home);
const evidence = resolve(process.env.XOPC_BROWSER_PRODUCTION_EVIDENCE || (nativePermissions ? '/tmp/xopc-browser-native-permissions' : recovery ? '/tmp/xopc-browser-recovery' : '/tmp/xopc-browser-production'));
await mkdir(evidence, { recursive: true });
const configPath = join(root, 'xopc.json');
Object.assign(process.env, { XOPC_STATE_DIR: root, XOPC_CONFIG_PATH: configPath, XOPC_CONFIG: configPath,
  XOPC_WORKSPACE: root, XOPC_MODELS_JSON: join(root, 'models.json'), PI_CODING_AGENT_DIR: join(root, 'pi'),
  XOPC_BROWSER_EXT_BUNDLED_ROOT: join(root, 'bundled-extension'), XOPC_UI_STATIC_ROOT: join(root, 'ui'), XOPC_BUNDLED_SKILLS_ROOT: join(root, 'skills'), XOPC_LOG_LEVEL: 'warn', XOPC_LOG_CONSOLE: 'false', XOPC_LOG_FILE: 'false' });
const modelRequests: Array<{ id: number; status?: number; toolNames: string[]; skillCatalogHasConfigureXopc?: boolean; elapsedMs?: number }> = [];
let pauseAfterRead = false;
let pausedAfterRead = false;
let resumeProxy: (() => void) | undefined;
const proxy = createServer(async (req, res) => {
  try {
    assert(req.url === '/v1/chat/completions', 'Unexpected model endpoint');
    let source = ''; for await (const chunk of req) source += chunk;
    const body = JSON.parse(source);
    if (cloud) body.model = modelId;
    const lastMessage = body.messages.at(-1);
    const lastToolName = body.messages.flatMap((message: any) => message.tool_calls ?? []).find((call: any) => call.id === lastMessage?.tool_call_id)?.function?.name;
    if (pauseAfterRead && lastMessage?.role === 'tool' && lastToolName === 'browser_use' && String(lastMessage.content).includes('Read check:')) {
      pauseAfterRead = false; pausedAfterRead = true;
      await new Promise<void>(resolve => { resumeProxy = resolve; res.once('close', resolve); });
      if (!nativePermissions) { res.end(); return; }
    }
    assert(modelRequests.length < (recovery || nativePermissions ? 180 : 48), 'Real model request budget exceeded');
    const event = { id: modelRequests.length + 1, toolNames: (body.tools ?? []).map((t: { function?: { name: string } }) => t.function?.name).filter(Boolean) } as typeof modelRequests[number];
    event.skillCatalogHasConfigureXopc = JSON.stringify(body.messages.filter((m: any) => m.role === 'system')).includes('configure-xopc');
    modelRequests.push(event);
    const start = Date.now();
    if (cloud && JSON.parse(await readFile(cloudCredentialPath, 'utf8')).expiresAt <= Date.now() + 60_000) {
      const refresh = spawn(process.execPath, ['--import', 'tsx', '--input-type=module'], { cwd: resolve('.'), env: credentialEnv, stdio: ['pipe', 'ignore', 'ignore'] });
      refresh.stdin.end("import { CredentialResolver } from './src/auth/credentials.ts'; await new CredentialResolver().resolveApiKey('xopc-cloud'); process.exit(0);");
      const [code] = await once(refresh, 'exit'); assert.equal(code, 0, 'Cloud credential refresh failed');
    }
    const credential = cloud ? JSON.parse(await readFile(cloudCredentialPath, 'utf8')).access : upstreamKey;
    const response = await fetch(cloud ? 'https://router.xopc.ai/v1/chat/completions' : 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', { method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...(cloud ? {} : { enable_thinking: false }) }), signal: AbortSignal.timeout(150_000) });
    event.status = response.status;
    res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') ?? 'application/json' });
    if (response.body) for await (const chunk of response.body) res.write(chunk);
    res.end(); event.elapsedMs = Date.now() - start;
  } catch (error) { if (!res.headersSent) res.writeHead(502); res.end(JSON.stringify({ error: 'Acceptance model request failed' })); console.error(error instanceof Error ? error.message : 'Model failure'); }
});
proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
const modelAddress = proxy.address(); assert(modelAddress && typeof modelAddress !== 'string');
const probe = createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
const address = probe.address(); assert(address && typeof address !== 'string'); const port = address.port;
await new Promise<void>(r => probe.close(() => r()));
const base = `http://127.0.0.1:${port}`;
const token = randomUUID();
const modelId = process.env.XOPC_BROWSER_SETUP_MODEL ?? (cloud ? 'openai-codex/gpt-5.6-sol' : 'qwen3.8-flash');
const localModelId = cloud ? 'gpt-5.6-sol' : modelId;
const modelRef = `browser-live/${localModelId}`;
const [{ AgentDefaultsSchema }, catalog, db] = await Promise.all([
  import('../src/agent-config/schema.js'),
  import('../src/agent-catalog/test-support.js'), import('../src/storage/sqlite/connection.js'),
]);
await writeFile(configPath, JSON.stringify({ gateway: { bind: 'loopback', port, auth: { mode: 'token', token } },
  browser: { enabled: false, driver: { kind: 'extension' }, observation: { visualFallback: false } } }), { mode: 0o600 });
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { 'browser-live': { baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`, api: 'openai-completions', apiKey: 'isolated-proxy',
  models: [{ id: localModelId, name: cloud ? 'XOPC Cloud GPT-5.6 Sol acceptance' : 'Real Qwen browser acceptance', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096 }] } } }), { mode: 0o600 });
db.openXopcDatabase();
catalog.seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: modelRef, fallbacks: [] }, background: { primary: modelRef, fallbacks: [] } },
  runtime: { maxTurns: 32, timeoutMs: 240000, thinkingLevel: 'off' } }),
  agents: [{ id: 'main', enabled: true, workspace: root, profile: { name: 'Browser acceptance assistant', language: 'zh' },
    skills: { mode: 'replace', include: ['configure-xopc'] },
    toolAllowlist: ['xopc_use', 'tool_manual', 'skills_list', 'skill_view', 'browser_use', 'clarify'],
    tools: Object.fromEntries(['xopc_use', 'tool_manual', 'skills_list', 'skill_view', 'browser_use', 'clarify'].map(t => [t, { mode: 'allow' }])) }] });
db.closeXopcDatabase();
await cp(resolve('packages/browser-ext'), join(root, 'bundled-extension'), { recursive: true, filter: source => !source.includes('node_modules') && !source.includes('/src/') && !source.includes('/scripts/') });
await cp(resolve('skills'), join(root, 'skills'), { recursive: true });
await cp(resolve(process.env.XOPC_BROWSER_PRODUCTION_UI_ROOT ?? 'dist/gateway/static/root'), join(root, 'ui'), { recursive: true });
const childEnv = { ...process.env, HOME: home, XOPC_NO_RESPAWN: '1' };
let child: ReturnType<typeof spawn>;
let logs = '';
function launchGateway() {
 child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/cli/bin.ts'), 'gateway', '--port', String(port), '--no-hot-reload'], { cwd: resolve('.'), env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
 child.stdout!.on('data', c => { logs += c; }); child.stderr!.on('data', c => { logs += c; });
}
launchGateway();
let context: BrowserContext | undefined;
let ui: Page | undefined;
let extensionPage: Page | undefined;
const conversationId = randomUUID();
const stages: Array<Record<string, unknown>> = [];
const recordedTurns: Array<{ input: string; tools: Array<{ name: string; input: unknown }>; answer: string }> = [];
const request = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) });
  const result = await response.json() as Record<string, unknown>;
  assert(response.ok, `${path}: ${response.status} ${JSON.stringify(result)}`);
  return (result.payload ?? result) as any;
};
async function until<T>(check: () => Promise<T | undefined | false>, label: string, timeout = 120_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { assert(child.exitCode === null, `Gateway exited ${child.exitCode}`); const result = await check(); if (result) return result; await delay(500); }
  throw new Error(`Timeout: ${label}`);
}
async function readHistory() { return request(`/api/sessions/${conversationId}?include=transcriptRows`); }
async function send(content: string, initial = false) {
  const start = Date.now();
  let input;
  if (initial) input = { kind: 'start', creation: { agentId: 'main', projectId: null, execution: null, temporary: false, model: modelRef, thinkingLevel: 'off' } };
  else {
    const session = await readHistory();
    const config = await request(`/api/sessions/${conversationId}/agent-config`);
    input = { kind: 'append', expectedTranscriptId: session.transcriptId ?? session.session?.transcriptId,
      configVersion: config.configVersion ?? config.version ?? 0, delivery: 'next', interrupt: false };
  }
  const response = await request(`/api/sessions/${conversationId}/inputs`, { ...input, clientMessageId: randomUUID(), input: { content }, origin: { type: 'system', source: 'cli' } });
  console.log(JSON.stringify({ stage: 'input_accepted', text: content, resultKeys: Object.keys(response) }));
  await until(async () => {
    const state = await request(`/api/sessions/${conversationId}/input-state`);
    return !state.activeRunId && !state.inputs?.some((i: { status: string }) => ['queued', 'running'].includes(i.status)) ? true : undefined;
  }, 'model turn completed', 250_000);
  assert(!modelRequests.some(r => r.status && r.status >= 400), `Real model returned an HTTP error: ${modelRequests.filter(r => r.status && r.status >= 400).map(r => r.status).join(',')}`);
  const history = await readHistory();
  await writeFile(join(evidence, 'history.private.json'), JSON.stringify(history, null, 2), { mode: 0o600 });
  const messages = history.messages ?? history.session?.messages ?? [];
  const tools = messages.flatMap((m: any) => (m.content ?? []).filter?.((b: any) => b.type === 'tool_use' || b.type === 'toolCall').map((b: any) => ({ name: b.name, input: b.input ?? b.arguments })) ?? []);
  const answer = messages.filter((m: any) => m.role === 'assistant').map((m: any) => typeof m.content === 'string' ? m.content : (m.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')).join('\n');
  recordedTurns.push({ input: content, tools, answer });
  console.log(JSON.stringify({ stage: 'turn_completed', elapsedMs: Date.now() - start, toolCount: tools.length, answer: answer.slice(-1600) }));
  return history;
}
try {
 acceptance: {
  await until(async () => { try { return (await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) })).ok || undefined; } catch { return undefined; } }, 'Gateway boot', 90_000);
  stages.push({ stage: 'isolated_gateway', productionEntry: true, originalStateUntouched: true });
  if (pairingOnly) {
    db.openXopcDatabase();
    (await import('../src/storage/sqlite/conversation-repository.js')).createConversation({ agentId: 'main' }, root, conversationId);
    db.closeXopcDatabase();
    await request('/api/browser/setup', { conversationId, action: 'start' });
  } else await send('帮我配置 Browser Use', true);
  let inspection = await request('/api/browser/setup', { conversationId, action: 'inspect' });
  if (!inspection.setup) {
    await send('我要连接本机 Chrome，请带我完成配置和验收。');
    inspection = await request('/api/browser/setup', { conversationId, action: 'inspect' });
  }
  assert(inspection.setup, 'Model did not start Browser setup');
  const setupId = inspection.setup.id;
  console.log(JSON.stringify({ stage: 'setup_created', state: inspection.setup.state }));
  const extension = join(root, 'bundled-extension');
  context = await chromium.launchPersistentContext(join(root, 'chrome-profile'), { channel: 'chromium', headless: !nativePermissions, locale: 'en-US',
    env: { ...childEnv, CFFIXED_USER_HOME: home }, ignoreDefaultArgs: ['--disable-extensions', ...(nativePermissions ? ['--enable-automation'] : [])], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => { await chrome.storage.local.set({ 'xopc.browser.auto-connect': false }); });
  ui = await context.newPage(); ui.setDefaultTimeout(30_000);
  await ui.goto(`${base}/#/chat/${conversationId}?scene=configure-xopc`);
  await ui.getByPlaceholder(/Token or password|Token 或 Password/).fill(token);
  await ui.getByRole('button', { name: /^Connect$|^连接$/ }).click();
  for (const name of ['Maybe later, keep using my current model', 'Skip for now', '以后再说，继续使用当前模型', '暂时跳过']) {
    try { await ui.getByRole('button', { name, exact: true }).click({ timeout: 1500 }); } catch {}
  }
  await ui.goto(`${base}/#/chat/${conversationId}?scene=configure-xopc`);
  const panel = ui.getByRole('region', { name: /Browser Use/ });
  if (pairingOnly) {
    await request('/api/browser/setup', { conversationId, setupId, action: 'approve', expectedRevision: inspection.setup.revision });
    await request('/api/browser/setup', { conversationId, setupId, action: 'prepare' });
  } else await panel.getByRole('button', { name: /Enable Chrome and prepare files|启用 Chrome 连接并准备文件/ }).click();
  await until(async () => { const value = await request('/api/browser/setup', { conversationId, action: 'inspect' }); return value.setup?.state === 'waiting_extension' ? value.setup : undefined; }, 'real extension preparation', 90_000);
  stages.push({ stage: 'owner_approved_and_prepared', nativeHostFilesInIsolatedHome: true });
  console.log(JSON.stringify(stages.at(-1)));
  // Chromium resolves user-level hosts beneath its explicit user-data-dir.
  await mkdir(join(root, 'chrome-profile', 'NativeMessagingHosts'), { recursive: true });
  await cp(join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/ai.xopc.browser.json'), join(root, 'chrome-profile', 'NativeMessagingHosts/ai.xopc.browser.json'));
  const extensionId = new URL(worker.url()).hostname;
  const sidepanel = await context.newPage(); extensionPage = sidepanel;
  context.on('response', async response => { if ((response.url().includes('/api/device-pairing/') || response.url().includes('/api/device-auth/')) && response.status() >= 400) {
    const body = response.request().postDataJSON();
    console.log(JSON.stringify({ stage: 'pairing_http_error', status: response.status(), action: response.url().split('/').at(-1), response: await response.json(), fields: Object.keys(body) }));
  } });
  await sidepanel.goto(`chrome-extension://${extensionId}/dist/sidepanel.html`);
  const nativePermissionResults: Array<Record<string, unknown>> = [];
  if (nativePermissions) {
    const manifest = JSON.parse(await readFile(join(root, 'chrome-profile', 'NativeMessagingHosts/ai.xopc.browser.json'), 'utf8'));
    assert(manifest.path.startsWith(root));
    await chmod(manifest.path, 0o600);
    await sidepanel.getByRole('button', { name: /Connect local Gateway|连接本机 Gateway/ }).click();
    await sidepanel.locator('.error-text').filter({ hasText: /could not start|启动被阻止/ }).waitFor();
    assert.equal((await request('/api/browser/status')).driverStatus?.connected, false);
    await send('Chrome 提示本机连接程序启动被阻止。我暂时保留拒绝，请检查并解释怎么在这个原对话恢复；先不要修复或修改系统安全设置。');
    assert.equal((await request('/api/browser/setup', { conversationId, action: 'inspect' })).installation.nativeHostInstalled, false, 'Model must preserve the refused host before owner repair');
    assert.equal((await request('/api/browser/status')).driverStatus?.connected, false);
    await request('/api/browser/setup', { conversationId, setupId, action: 'recheck' });
    await ui!.reload();
    await panel.getByRole('button', { name: /Repair preparation|重新检查并准备/ }).click();
    const { browserNativeHostDoctor } = await import('../src/browser/providers/browser-ext-install.js');
    assert(browserNativeHostDoctor('darwin', home).installed);
    nativePermissionResults.push({ scenario: 'os_native_host_execution_denied', realOsError: 'EACCES', popupObserved: false, pairingPrevented: true, originalConversation: true, ownerRepair: true });
  }
  await sidepanel.getByRole('button', { name: /Connect local Gateway|连接本机 Gateway/ }).click();
  console.log(JSON.stringify({ stage: 'native_bootstrap_requested_through_chrome' }));
  const pairingStartedAt = Date.now();
  const endpoints = await until(async () => {
    const pairingError = await sidepanel.locator('.error-text').allTextContents();
    if (pairingError.some(Boolean)) throw new Error(`Production pairing failed: ${pairingError.join(' ').slice(0, 500)}`);
    const bridge = await sidepanel.evaluate(() => chrome.runtime.sendMessage({ type: 'browser/get-status' }));
    if (bridge?.error && Date.now() - pairingStartedAt > 10000) throw new Error(`Production Realtime failed: ${bridge.error}`);
    const result = await request('/api/browser/status');
    return result.driverStatus?.connected && result.driverStatus?.transport === 'gateway-realtime' ? result.driverStatus.endpoints : undefined;
  }, 'production paired Realtime endpoint', 60_000);
  assert.equal(endpoints.length, 1);
  stages.push({ stage: 'native_bootstrap_pairing_realtime', productionAuth: true, endpointCount: endpoints.length, transport: 'gateway-realtime' });
  if (pairingOnly) { console.log(JSON.stringify({ stage: 'pairing_only_passed', stages })); break acceptance; }
  await ui.reload();
  const select = panel.getByRole('button', { name: /Choose Chrome to test|选择用于验收的 Chrome/ });
  await select.click(); await ui.getByRole('button', { name: `${endpoints[0].displayName} · ${endpoints[0].endpointId.slice(0, 12)}`, exact: true }).click();
  // The owner product action starts a real model turn in the existing conversation.
  const baselineDebuggerTargets = await worker.evaluate(() => chrome.debugger.getTargets());
  const baselineTargetIds = new Set(baselineDebuggerTargets.map(target => target.id));
  if (nativePermissions) { pauseAfterRead = true; pausedAfterRead = false; }
  await panel.getByRole('button', { name: /Start demo test|开始演示验收/ }).click();
  if (nativePermissions) {
    const interrupted = await until(async () => { const value = (await request('/api/browser/setup', { conversationId, action: 'inspect' })).setup;
      return value?.attempt?.read && pausedAfterRead ? value : undefined; }, 'native stop ready');
    await writeFile(join(evidence, 'native-state.json'), JSON.stringify({ stage: 'cancel_chrome_debugging', extensionId, fixtureUrl: interrupted.attempt.fixtureUrl }));
    console.log(JSON.stringify({ stage: 'cancel_chrome_debugging', extensionId, fixtureUrl: interrupted.attempt.fixtureUrl }));
    await until(async () => (await sidepanel.evaluate(() => chrome.runtime.sendMessage({ type: 'browser/get-status' }))).controlPaused ? true : undefined, 'real Chrome Cancel', 90_000);
    resumeProxy?.();
    await until(async () => !(await request(`/api/sessions/${conversationId}/input-state`)).activeRunId ? true : undefined, 'model stops and cleans up', 120_000);
    let stopped = (await request('/api/browser/setup', { conversationId, action: 'inspect' })).setup;
    assert(stopped.attempt.released, 'Model must release stopped demo');
    assert.notEqual(stopped.state, 'completed'); assert.equal(stopped.attempt.clicked, false);
    assert((await sidepanel.evaluate(() => chrome.runtime.sendMessage({ type: 'browser/get-status' }))).controlPaused, 'Cleanup must not grant Chrome control');
    await sidepanel.reload();
    await sidepanel.getByRole('button', { name: /Resume browser control|恢复网页控制/ }).waitFor();
    await writeFile(join(evidence, 'native-state.json'), JSON.stringify({ stage: 'resume_chrome_control', extensionId }));
    console.log(JSON.stringify({ stage: 'resume_chrome_control', extensionId }));
    await until(async () => !(await sidepanel.evaluate(() => chrome.runtime.sendMessage({ type: 'browser/get-status' }))).controlPaused ? true : undefined, 'explicit extension resume', 180_000);
    await send('我已经在 xopc 扩展点击恢复网页控制，请在原对话重新检查并准备新一次验收，不重复旧测试，也不要修改其他权限。');
    let checked = (await request('/api/browser/setup', { conversationId, action: 'inspect' })).setup;
    if (checked.state !== 'ready_for_verification') {
      await ui!.reload(); await panel.getByRole('button', { name: /Repair preparation|重新检查并准备/ }).click();
    }
    await ui!.reload();
    await panel.getByRole('button', { name: /Choose Chrome to test|选择用于验收的 Chrome/ }).click();
    await ui!.getByRole('button', { name: `${endpoints[0].displayName} · ${endpoints[0].endpointId.slice(0, 12)}`, exact: true }).click();
    await panel.getByRole('button', { name: /Start demo test|开始演示验收/ }).click();
    checked = (await request('/api/browser/setup', { conversationId, action: 'inspect' })).setup;
    assert.notEqual(checked.attempt.id, interrupted.attempt.id, 'Consent recovery needs fresh verification evidence');
    nativePermissionResults.push({ scenario: 'chrome_debugging_cancel', nativeUiCancel: true, pauseSurvivedReload: true, modelDidNotOverride: true, stoppedDemoReleased: true, explicitExtensionResume: true, sameConversation: true, freshAttempt: true });
  }
  let completed = await until(async () => {
    const result = await request('/api/browser/setup', { conversationId, action: 'inspect' });
    if (result.setup?.state === 'needs_attention') throw new Error(`Verification requires attention: ${result.setup.error}`);
    return result.setup?.state === 'completed' && !result.setup.stale ? result.setup : undefined;
  }, 'real model verification and release', 250_000);
  await until(async () => {
    const state = await request(`/api/sessions/${conversationId}/input-state`);
    return !state.activeRunId && !state.inputs?.some((i: { status: string }) => ['queued', 'running'].includes(i.status)) && modelRequests.every(r => r.elapsedMs !== undefined) ? true : undefined;
  }, 'final model report', 120_000);
  const recoveryResults: Array<Record<string, unknown>> = [];
  if (recovery) {
    const inspect = async () => (await request('/api/browser/setup', { conversationId, action: 'inspect' })).setup;
    const idle = () => until(async () => { const state = await request(`/api/sessions/${conversationId}/input-state`); return !state.activeRunId ? true : undefined; }, 'recovery turn idle', 250_000);
    const chooseAndTest = async () => {
      await ui!.reload();
      await panel.getByRole('button', { name: /Choose Chrome to test|选择用于验收的 Chrome/ }).click();
      await ui!.getByRole('button', { name: `${endpoints[0].displayName} · ${endpoints[0].endpointId.slice(0, 12)}`, exact: true }).click();
      await panel.getByRole('button', { name: /Start demo test|开始演示验收/ }).click();
    };
    const verified = async () => {
      const value = await until(async () => { const value = await inspect();
        if (value.state === 'needs_attention') throw new Error(`Recovery verification: ${value.error}`);
        return value.state === 'completed' && !value.stale ? value : undefined;
      }, 'recovery verified', 250_000);
      await idle(); assert(Object.values(value.checks).every(Boolean));
      assert.equal(context!.pages().filter(p => p.url().includes('browser-setup-test')).length, 0);
      return value;
    };
    // Corrupt only the installed product artifact; the loaded original extension stays paired.
    const installer = await import('../src/browser/providers/browser-ext-install.js');
    const installed = await installer.browserExtDoctor();
    assert(installed.extensionDir?.startsWith(root));
    await rm(join(installed.extensionDir!, 'dist/background.js'));
    await send('之前已经装过 Browser Use，现在本机扩展文件损坏了。请检查并修复，继续在这个对话完成验收，不要重新配对正常连接。');
    let current = await inspect(); assert.notEqual(current.id, completed.id, 'Repair must create a reviewed plan');
    assert.equal(current.state, 'plan_ready');
    await ui!.reload();
    await panel.getByRole('button', { name: /Enable Chrome and prepare files|启用 Chrome 连接并准备文件/ }).click();
    await until(async () => (await inspect()).state === 'ready_for_verification' ? true : undefined, 'repair ready');
    assert.equal((await installer.browserExtDoctor()).installed, true);
    await chooseAndTest(); completed = await verified();
    assert.equal(completed.attempt.endpointId, endpoints[0].endpointId);
    recoveryResults.push({ scenario: 'existing_installation_repair', sameConversation: true, pairedEndpointPreserved: true, checks: completed.checks });
    console.log(JSON.stringify(recoveryResults.at(-1)));

    await send('请在这个对话重新做一次 Browser Use 验收，我会在面板确认。');
    current = await inspect(); assert.equal(current.state, 'plan_ready');
    await ui!.reload(); await panel.getByRole('button', { name: /Enable Chrome and prepare files|启用 Chrome 连接并准备文件/ }).click();
    await until(async () => (await inspect()).state === 'ready_for_verification' ? true : undefined, 'permission scenario ready');
    await request('/api/agents/main', { tools: { browser_use: { mode: 'deny' } } }, 'PATCH');
    await chooseAndTest();
    await panel.getByRole('alert').filter({ hasText: /cannot use the browser|尚未获准/ }).waitFor();
    current = await inspect(); assert(!current.attempt, 'Denied permission must not create a verification session');
    const deniedSetupId = current.id;
    await send('页面提示这个助手没有浏览器权限。我暂时不授权，请告诉我原因和以后怎么在这个对话继续，不要改权限。');
    assert.equal((await request('/api/browser/setup', { conversationId, action: 'inspect' })).toolPermission, 'denied');
    assert.equal((await inspect()).id, deniedSetupId, 'Model must not replace the denied plan');
    assert.equal(context!.pages().filter(p => p.url().includes('browser-setup-test')).length, 0);
    await request('/api/agents/main', { tools: { browser_use: { mode: 'allow' } } }, 'PATCH');
    await send('我已经在助手设置里允许 Browser Use 了，请在这个原对话恢复刚才的配置，等待我开始验收。');
    assert.equal((await inspect()).id, current.id, 'Permission recovery must keep the pending setup');
    pauseAfterRead = true; pausedAfterRead = false;
    await chooseAndTest();
    const interrupted = await until(async () => { const value = await inspect(); return value.attempt?.read && pausedAfterRead ? value : undefined; }, 'pause after real browser read');
    const state = await request(`/api/sessions/${conversationId}/input-state`);
    assert(context!.pages().some(p => p.url() === interrupted.attempt.fixtureUrl), 'Interrupted test must retain its demo tab');
    assert(state.activeRunId); await request('/api/agent/abort', { runId: state.activeRunId });
    resumeProxy?.(); await idle();
    await ui!.reload();
    assert.equal((await inspect()).attempt.id, interrupted.attempt.id);
    // Restart the real Gateway while keeping its database, Chrome profile and conversation.
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    launchGateway();
    await until(async () => { try { return (await fetch(`${base}/health`)).ok || undefined; } catch { return undefined; } }, 'Gateway restart', 90_000);
    await worker.evaluate(() => chrome.runtime.sendMessage({ type: 'browser/reconnect' }));
    await until(async () => (await request('/api/browser/status')).driverStatus?.connected ? true : undefined, 'Realtime reconnect');
    await ui!.reload();
    const restored = await inspect(); assert.equal(restored.id, interrupted.id); assert.equal(restored.attempt.id, interrupted.attempt.id);
    await send('刚才验收被中断了，服务也重启过。请在这个原对话恢复已保存的进度，完成剩余检查并释放演示控制；不要重复已经通过的操作。');
    completed = await inspect();
    if (completed.state !== 'completed') {
      assert(completed.attempt.released, 'Expired or interrupted attempt must be released before retest');
      await panel.getByRole('button', { name: /Repair preparation|重新检查并准备/ }).click();
      await chooseAndTest(); completed = await verified();
    } else await verified();
    recoveryResults.push({ scenario: 'permission_denial_recovery', deniedWithoutSession: true, permissionPreservedUntilOwnerChanged: true, sameConversation: true, checks: completed.checks });
    recoveryResults.push({ scenario: 'interruption_and_gateway_restart', persistedSetup: true, persistedAttempt: true, sameConversation: true,
      resumedAttempt: completed.attempt.id === interrupted.attempt.id, checks: completed.checks });
    console.log(JSON.stringify({ stage: 'recovery_scenarios_completed', recoveryResults }));
  }
  const history = await readHistory();
  await writeFile(join(evidence, 'history.private.json'), JSON.stringify(history, null, 2), { mode: 0o600 });
  const rows = history.session?.transcriptRows ?? history.transcriptRows ?? [];
  const calls = rows.flatMap((row: any) => row.role === 'assistant' && Array.isArray(row.content)
    ? row.content.filter((block: any) => block.type === 'toolCall').map((block: any) => ({ name: block.name, args: block.arguments })) : []);
  const resources = calls.filter((call: any) => call.name === 'skill_view' && call.args.name === 'configure-xopc').map((call: any) => call.args.path ?? 'SKILL.md');
  const required = ['SKILL.md', 'references/browser/overview.md', 'references/browser/chrome-extension.md', 'references/browser/acceptance.md'];
  let previous = -1;
  for (const path of required) { const index = resources.indexOf(path); assert(index > previous, `Missing or out-of-order progressive resource: ${path}`); previous = index; }
  assert(resources.every((path: string) => path === 'SKILL.md' || path.startsWith('references/browser/') || path === 'references/scene-index.md'), 'Unrelated scene was loaded');
  const browserErrors = rows.filter((row: any) => row.role === 'toolResult' && row.toolName === 'browser_use' && (row.isError || row.details?.ok === false));
  if (nativePermissions) {
    assert(browserErrors.length >= 1 && browserErrors.every((row: any) => JSON.stringify(row.content).includes('BROWSER_CONTROL_REVOKED')), 'Only the expected Chrome refusal is allowed');
  } else assert.equal(browserErrors.length, 0, 'Browser verification had a tool error');
  const actions = calls.filter((call: any) => call.name === 'browser_use').map((call: any) => call.args.action);
  for (const action of ['navigate', 'click', 'fill', 'close']) assert(actions.includes(action), `Real Agent did not call browser_use ${action}`);
  assert(calls.some((call: any) => call.name === 'xopc_use' && call.args.mode === 'browser_setup' && call.args.command === 'verification_report'), 'Model did not read host verification evidence');
  const debuggerTargets = await worker.evaluate(() => chrome.debugger.getTargets());
  assert(debuggerTargets.filter(target => !baselineTargetIds.has(target.id)).every(target => !target.attached), 'Demo left an attached debugger target');
  assert(Object.values(completed.checks).every(Boolean), 'Not every acceptance check passed');
  assert.equal(context.pages().filter(p => p.url().includes('browser-setup-test')).length, 0);
  await ui.screenshot({ path: join(evidence, 'completed.png'), fullPage: true });
  await until(async () => modelRequests.every(r => r.elapsedMs !== undefined) ? true : undefined, 'pending model request completion', 60_000);
  const report = { ok: true, model: modelId, gateway: 'production CLI', extension: 'production manifest/background/sidepanel',
    stages, upstreamProvider: cloud ? 'xopc-cloud' : 'dashscope', recoveryResults, nativePermissionResults, initialInput: '帮我配置 Browser Use', progressiveResources: resources, browserActions: actions, browserToolErrors: browserErrors.length, debuggerReleased: true, demoTabsClosed: true, checks: completed.checks, modelRequests, browser: await context.browser()?.version(),
    boundaries: ['Extension loaded with Chromium launch flags rather than the manual Load unpacked picker', 'Production-generated native host manifest copied into the isolated Chromium user-data-dir, matching Chromium host lookup', 'Native messaging, device pairing and Realtime use production code with isolated state and HOME', ...(nativePermissions ? ['Chrome debugger Cancel and extension Resume were operated through native UI', 'OS executable denial uses real EACCES, not an observed Gatekeeper or TCC dialog'] : [])] };
  await writeFile(join(evidence, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ stage: 'completed', evidence, checks: completed.checks }));
 }
} catch (error) {
  try { await ui?.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }); } catch {}
  if (extensionPage) await writeFile(join(evidence, 'extension.private.txt'), await extensionPage.locator('body').innerText().catch(() => 'unavailable'), { mode: 0o600 });
  await writeFile(join(evidence, 'gateway.private.log'), logs, { mode: 0o600 });
  await writeFile(join(evidence, 'model-requests.json'), JSON.stringify(modelRequests, null, 2));
  console.error(error instanceof Error ? error.message : 'Acceptance failed');
  process.exitCode = 1;
} finally {
  resumeProxy?.();
  await context?.close();
  if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await Promise.race([exited, delay(8000)]); if (child.exitCode === null) child.kill('SIGKILL'); }
  proxy.closeAllConnections(); await new Promise<void>(r => proxy.close(() => r()));
  db.closeXopcDatabase(); await rm(root, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
