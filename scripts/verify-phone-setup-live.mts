/** Real GPT-5.6 Sol guidance and AutoGLM device acceptance in an isolated production Gateway. */
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
const adb = process.env.XOPC_PHONE_ADB_PATH ?? join(process.env.HOME!, 'Library/Android/sdk/platform-tools/adb');
const devices = JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', join(originalState, 'xopc.db'), "SELECT payload FROM durable_state WHERE namespace='phone.devices'"], { encoding: 'utf8' }) || '[]').map((row: any) => JSON.parse(row.payload));
const selectedCloud = devices.find((d: any) => d.name === (process.env.XOPC_PHONE_DEVICE_NAME ?? '阿里云测试手机') && d.enabled && d.connection?.kind === 'aliyun-adb');
assert(selectedCloud, 'Configured Aliyun test phone not found');
const leases = JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', join(originalState, 'xopc.db'), "SELECT key,payload FROM durable_state WHERE namespace='phone.leases'"], { encoding: 'utf8' }) || '[]');
assert(!leases.some((row: any) => row.key === selectedCloud.serial && JSON.parse(row.payload).expiresAt > Date.now()), 'Cloud test phone is busy');
const localSerial = execFileSync(adb, ['devices'], { encoding: 'utf8' }).split('\n').find(line => /^emulator-\d+\s+device$/.test(line.trim()))?.split(/\s/)[0];
assert(localSerial, 'Start an authorized Android emulator first');
const { XopcCloudModelSource } = await import('../src/providers/xopc-cloud-model-source.js');
const catalog = await new XopcCloudModelSource().fetch();
assert(catalog.status === 'fetched' && catalog.models.some(m => m.id === 'phone' && m.phoneUse), 'Cloud Phone model unavailable');
const root = await mkdtemp(join(tmpdir(), 'xopc-phone-setup-live-'));
const evidence = resolve(process.env.XOPC_PHONE_SETUP_EVIDENCE ?? '/tmp/xopc-phone-setup-live');
await mkdir(evidence, { recursive: true });
await mkdir(join(root, 'home'));
const modelRequests: Array<{ id: number; status?: number; elapsedMs?: number; configureSkill: boolean }> = [];
let pauseAfterOpen = false; let paused = false; let resumeProxy: (() => void) | undefined;
const proxy = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); body.model = 'openai-codex/gpt-5.6-sol';
    const last = body.messages.at(-1);
    const priorCalls = body.messages.flatMap((message: any) => message.tool_calls ?? []);
    const prior = priorCalls.find((call: any) => call.id === last?.tool_call_id);
    if (pauseAfterOpen && last?.role === 'tool' && prior?.function?.name === 'phone_use' && JSON.parse(prior.function.arguments).op === 'open') {
      pauseAfterOpen = false; paused = true;
      await new Promise<void>(done => { resumeProxy = done; res.once('close', done); });
      if (res.destroyed) return;
    }
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
  XOPC_UI_STATIC_ROOT: process.env.XOPC_PHONE_SETUP_UI_ROOT ?? '/tmp/xopc-phone-setup-ui-build', XOPC_LOG_CONSOLE: 'false', XOPC_LOG_FILE: 'false', XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1' });
await writeFile(configPath, JSON.stringify({ gateway: { bind: 'loopback', port, auth: { mode: 'token', token } }, phone: { enabled: true, adbPath: adb }, browser: { enabled: false } }), { mode: 0o600 });
const modelRef = 'phone-setup-live/gpt-5.6-sol';
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { 'phone-setup-live': { baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`, api: 'openai-completions', apiKey: 'isolated-relay', models: [{ id: 'gpt-5.6-sol', name: 'XOPC Cloud GPT-5.6 Sol', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096 }] } } }), { mode: 0o600 });
const db = await import('../src/storage/sqlite/connection.js'); db.openXopcDatabase();
const { seedTestAgentCatalog } = await import('../src/agent-catalog/test-support.js');
const { AgentDefaultsSchema } = await import('../src/agent-config/schema.js');
const tools = ['xopc_use', 'tool_manual', 'skills_list', 'skill_view', 'phone_use', 'clarify'];
seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: modelRef }, background: { primary: modelRef }, phoneUse: { primary: 'xopc-cloud/phone' } }, runtime: { maxTurns: 32, timeoutMs: 300000, thinkingLevel: 'off' } }), agents: [{ id: 'main', enabled: true, workspace: root, profile: { name: 'Phone setup acceptance', language: 'zh' }, skills: { mode: 'replace', include: ['configure-xopc'] }, toolAllowlist: tools, tools: Object.fromEntries(tools.map(name => [name, { mode: 'allow' }])) }] });
const { getModelCatalogStore } = await import('../src/providers/model-catalog-store.js');
const { ModelCatalogPersistence } = await import('../src/providers/model-catalog-persistence.js');
getModelCatalogStore().replaceSourceModels('xopc-cloud', catalog.source, catalog.models);
await new ModelCatalogPersistence().save(getModelCatalogStore().getSource('xopc-cloud')!);
const { PhoneRepository } = await import('../src/phone/repository.js');
const repository = new PhoneRepository();
const cloud = repository.save({ ...selectedCloud, name: 'Aliyun setup acceptance', appAccess: 'selected', allowedApps: ['com.android.settings'] });
db.closeXopcDatabase();
await cp(resolve('skills'), join(root, 'skills'), { recursive: true });
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
let conversationId = randomUUID();
const history = () => request(`/api/sessions/${conversationId}?include=transcriptRows`);
const inspect = async () => (await request('/api/phone/setup', { conversationId, action: 'inspect' })).setup;
const idle = () => until(async () => { const value = await request(`/api/sessions/${conversationId}/input-state`); return !value.activeRunId && !value.inputs?.some((i: any) => ['queued', 'running'].includes(i.status)) ? true : undefined; }, 'model idle');
async function send(content: string, initial = false, wait = true) {
  let input: any = { kind: 'start', creation: { agentId: 'main', projectId: null, execution: null, temporary: false, model: modelRef, thinkingLevel: 'off' } };
  if (!initial) { const h = await history(); const config = await request(`/api/sessions/${conversationId}/agent-config`); input = { kind: 'append', expectedTranscriptId: h.transcriptId ?? h.session?.transcriptId, configVersion: config.configVersion ?? config.version ?? 0, delivery: 'next', interrupt: false }; }
  await request(`/api/sessions/${conversationId}/inputs`, { ...input, clientMessageId: randomUUID(), input: { content }, origin: { type: 'system', source: 'cli' } });
  console.log(JSON.stringify({ stage: 'input', content }));
  if (wait) { await idle(); await capture(); }
}
const results: any[] = [];
const ownerUi = process.env.XOPC_PHONE_SETUP_OWNER_UI === '1';
async function capture() { const h = await history(); await writeFile(join(evidence, `${conversationId}.private.json`), JSON.stringify(h, null, 2), { mode: 0o600 }); const rows = h.transcriptRows ?? h.session?.transcriptRows ?? []; const answer = rows.filter((r: any) => r.role === 'assistant').flatMap((r: any) => Array.isArray(r.content) ? r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text) : []).join('\n'); console.log(JSON.stringify({ stage: 'answer', text: answer.slice(-1800) })); return rows; }
async function begin(deviceId: string) { const s = await inspect(); return request('/api/phone/setup', { conversationId, action: 'begin_verification', setupId: s.id, deviceId, expectedRevision: s.revision }); }
async function approveInChat(deviceId: string) {
  const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.goto(`${base}/#/chat/${conversationId}?scene=configure-phone`);
    await page.getByPlaceholder(/Token or password|Token 或 Password/).fill(token);
    await page.getByRole('button', { name: /^Connect$|^连接$/ }).click();
    for (const name of ['Maybe later, keep using my current model', 'Skip for now', '以后再说，继续使用当前模型', '暂时跳过']) { try { await page.getByRole('button', { name, exact: true }).click({ timeout: 1200 }); } catch {} }
    await page.goto(`${base}/#/chat/${conversationId}?scene=configure-phone`);
    const panel = page.locator('section[aria-label]').filter({ has: page.getByText(/Phone Use ·/) });
    await panel.getByRole('button', { name: /Choose the phone to verify|明确选择用于验收的手机/ }).click();
    const current = await inspect(); const selected = current.readiness.devices.find((device: any) => device.id === deviceId); assert(selected);
    await page.getByRole('button', { name: selected.name, exact: true }).click();
    await panel.getByRole('button', { name: /Approve and start safe test|授权并开始安全验收/ }).click();
    await until(async () => (await inspect()).state === 'verifying' ? true : undefined, 'owner UI test approval');
    await until(async () => (await request(`/api/sessions/${conversationId}/input-state`)).activeRunId ? true : undefined, 'UI continuation in original chat');
    await idle();
    await panel.screenshot({ path: join(evidence, 'owner-ui-completed.png') });
    results.push({ scenario: 'owner_ui_approval_and_same_chat_continuation', conversationId, dispatched: true });
    await capture();
  } finally { await browser.close(); }
}
async function cleanup() { try { const s = await inspect(); if (s?.attempt && !s.attempt.released) await request('/api/phone/setup', { conversationId, setupId: s.id, action: 'release' }); } catch {} }
launch();
try {
  await ready();
  for (const source of (process.env.XOPC_PHONE_SETUP_SOURCE ? [process.env.XOPC_PHONE_SETUP_SOURCE] : ['local', 'aliyun']) as Array<'local' | 'aliyun'>) {
    conversationId = randomUUID();
    await send('帮我配置 Phone Use', true);
    let s = await inspect(); assert(s?.id, 'Natural request did not create setup');
    assert(!s.attempt, 'Model started a test without owner approval');
    await request('/api/phone/setup', { conversationId, action: 'source', setupId: s.id, source, expectedRevision: s.revision });
    await send(source === 'local' ? '我选择本机 Android 模拟器，请检查需要准备什么并引导我连接。' : '我选择已有阿里云手机，请复用已配置的连接，检查还需要准备什么。');
    let deviceId = cloud.id;
    if (source === 'local') { const device = await request('/api/phone/devices', { serial: localSerial, name: 'Local setup emulator', appAccess: 'selected', allowedApps: ['com.android.settings'] }); deviceId = device.id; await send('我已经在手机设置页面添加好本机模拟器并授权了 USB 调试，请重新检查，等我开始验收。'); }
    s = ownerUi ? await inspect() : await begin(deviceId); if (!ownerUi) assert.equal(s.state, 'verifying');
    const continuation = `Use configure-xopc for Phone Use setup ${s.id}. Read references/phone/acceptance.md and phone_setup get. Perform only the approved real phone_use test, close its session, and read verification_report. Do not modify any other setting.`;
    if (source === 'local' && !ownerUi) {
      pauseAfterOpen = true; paused = false;
      await send(continuation, false, false);
      await until(async () => paused && (await inspect()).attempt?.sessionId ? true : undefined, 'real phone open before interruption');
      const interrupted = await inspect(); const input = await request(`/api/sessions/${conversationId}/input-state`);
      assert(input.activeRunId); await request('/api/agent/abort', { runId: input.activeRunId }); resumeProxy?.(); await idle();
      const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; launch(); await ready();
      const restored = await inspect(); assert.equal(restored.id, interrupted.id); assert.equal(restored.attempt.id, interrupted.attempt.id);
      await send('刚才验收中断，Gateway 也重启过。请在这个原对话恢复配置，检查现状，不要重放不确定操作，也不要把旧验收当作成功。');
      await cleanup(); const released = await inspect(); assert(released.attempt.released); assert.notEqual(released.state, 'completed');
      s = await begin(deviceId); results.push({ source, scenario: 'interruption_and_restart', sameConversation: true, sameSetup: restored.id === interrupted.id, released: released.checks.released });
    }
    let completed: any;
    for (let retry = 0; retry < 3; retry++) {
      if (ownerUi) await approveInChat(deviceId);
      else await send(`Use configure-xopc for Phone Use setup ${s.id}. Read references/phone/acceptance.md and phone_setup get. Perform only the approved real phone_use test, close its session, and read verification_report. Do not modify any other setting.`);
      completed = await inspect();
      if (completed.state === 'completed') break;
      const h = await history(); const rows = h.transcriptRows ?? h.session?.transcriptRows ?? [];
      const latestFailure = rows.filter((row: any) => row.role === 'toolResult' && row.toolName === 'phone_use' && row.isError).at(-1);
      const limited = JSON.stringify(latestFailure?.content).includes('HTTP 429');
      if (!limited || retry === 2) break;
      assert(completed.attempt.released, 'Do not retry an unreleased or uncertain phone operation');
      results.push({ source, scenario: 'model_rate_limit_recovery', attemptId: completed.attempt.id, released: true, delayMs: 30000 });
      console.log(JSON.stringify({ stage: 'provider_rate_limit_backoff', source, retry }));
      await delay(30000);
      await send('刚才手机模型服务暂忙，但测试已释放。请在原对话重新检查配置，等待我重新授权开始新验收，不要重放旧操作。');
      s = ownerUi ? await inspect() : await begin(deviceId);
    }
    const blockedByQuota = completed.error?.includes('PHONE_MODEL_QUOTA_EXHAUSTED');
    if (!blockedByQuota) {
      assert.equal(completed.state, 'completed', `Actual ${source} test did not pass: ${JSON.stringify(completed)}`);
      assert(Object.values(completed.checks).every(Boolean));
    } else {
      assert(completed.checks.released && !completed.checks.verified && !completed.checks.operated);
      results.push({ source, scenario: 'external_phone_model_free_quota_exhausted', blocker: 'free_quota_exhausted', released: true, verified: false });
    }
    const rows = await capture();
    const calls = rows.flatMap((row: any) => row.role === 'assistant' && Array.isArray(row.content) ? row.content.filter((b: any) => b.type === 'toolCall').map((b: any) => ({ name: b.name, args: b.arguments })) : []);
    const resources = calls.filter((call: any) => call.name === 'skill_view' && call.args.name === 'configure-xopc').map((call: any) => call.args.path ?? 'SKILL.md');
    assert(resources.includes('SKILL.md') && resources.includes('references/phone/overview.md') && resources.includes(`references/phone/${source}.md`) && resources.includes('references/phone/acceptance.md'), `Missing progressive resources: ${resources}`);
    assert(resources.every((path: string) => path === 'SKILL.md' || path === 'references/scene-index.md' || path.startsWith('references/phone/')), 'Unrelated scene loaded');
    const operations = calls.filter((call: any) => call.name === 'phone_use').map((call: any) => call.args.op);
    for (const op of ['open', 'observe', 'run', 'close']) assert(operations.includes(op), `Missing real phone action ${op}`);
    assert(calls.some((call: any) => call.name === 'xopc_use' && call.args.mode === 'phone_setup' && call.args.command === 'verification_report'), 'Model did not read host report');
    const metadata = await request(`/api/phone/sessions`);
    const activeReceipts = metadata.sessions.filter((report: any) => report.deviceId === deviceId);
    assert(activeReceipts.length > 0 && activeReceipts.every((report: any) => report.status === 'closed' && report.controlOwner === 'none'), 'Setup left device control active');
    const probe = await request('/api/phone/sessions', { deviceId, agentId: 'main', mode: 'control' });
    const probeClosed = await request(`/api/phone/sessions/${probe.id}/execute`, { op: 'close' });
    assert.equal(probeClosed.status, 'closed'); assert.equal(probeClosed.controlOwner, 'none');
    results.push({ source, conversationId, setupId: completed.id, independentlyReacquiredAndReleased: true, checks: completed.checks, resources, operations, phoneReports: [...metadata.sessions, ...metadata.history].filter((report: any) => report.deviceId === deviceId).map((report: any) => ({ sessionId: report.sessionId, status: report.status, verified: report.verified, modelRequests: report.modelRequests, actions: report.actions, controlOwner: report.controlOwner, verificationLevel: report.verificationLevel, mock: report.mock })) });
    console.log(JSON.stringify({ stage: blockedByQuota ? 'device_model_quota_blocked' : 'device_passed', source, checks: completed.checks }));
  }
  assert(modelRequests.length > 0 && modelRequests.every(r => r.status === 200), 'Real guidance API error');
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ ok: !results.some(r => r.blocker), status: results.some(r => r.blocker) ? 'blocked' : 'completed', initialInput: '帮我配置 Phone Use', chatModel: 'xopc-cloud/openai-codex/gpt-5.6-sol', phoneModel: 'xopc-cloud/phone', results, modelRequests, boundaries: ['Existing cloud registration reused with Settings-only policy in isolated state', 'Local connection registered through real Gateway API after emulator discovery', 'Owner source selection and test approval exercised through authenticated product APIs', 'Cloud purchase and physical USB RSA prompt not exercised'] }, null, 2));
  if (results.some(r => r.blocker)) process.exitCode = 2;
  console.log(JSON.stringify({ stage: results.some(r => r.blocker) ? 'blocked' : 'completed', evidence }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Acceptance failed'); process.exitCode = 1;
  await capture().catch(() => {});
  await writeFile(join(evidence, 'failure.private.log'), logs, { mode: 0o600 });
  await writeFile(join(evidence, 'model-requests.json'), JSON.stringify(modelRequests, null, 2));
} finally {
  resumeProxy?.(); await cleanup();
  if (child!.exitCode === null) { const exited = once(child!, 'exit'); child!.kill('SIGTERM'); await Promise.race([exited, delay(8000)]); if (child!.exitCode === null) child!.kill('SIGKILL'); }
  proxy.closeAllConnections(); await new Promise<void>(done => proxy.close(() => done())); db.closeXopcDatabase(); await rm(root, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
