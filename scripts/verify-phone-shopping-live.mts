import '../src/infra/http-proxy-env.js';

/** Read-only shopping trials on a registered test phone through an isolated authenticated Gateway. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { ConfigSchema } from '../src/config/schema.js';
import { resolveCredentialsDir, resolveStateDir } from '../src/config/paths.js';
import { AgentDefaultsSchema } from '../src/agent-config/schema.js';
import { seedTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { closeXopcDatabase, openXopcDatabase } from '../src/storage/sqlite/connection.js';
import { PhoneRepository } from '../src/phone/repository.js';
import { PhoneCloudKeyStore, CloudAdbConnection } from '../src/phone/cloud-adb.js';
import type { PhoneDevice } from '../src/phone/contracts.js';
import { getApiKey, resolveModel, resetModelRegistry, getModelRegistry } from '../src/providers/index.js';
import { XopcCloudModelSource } from '../src/providers/xopc-cloud-model-source.js';
import { getModelCatalogStore } from '../src/providers/model-catalog-store.js';
import { ModelCatalogPersistence } from '../src/providers/model-catalog-persistence.js';

assert(process.env.XOPC_PHONE_REAL_MODEL === '1', 'Set XOPC_PHONE_REAL_MODEL=1 for actual device/model operations');
const originalState = resolveStateDir();
const credentials = resolveCredentialsDir();
const records = JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', join(originalState, 'xopc.db'),
  "SELECT payload FROM durable_state WHERE namespace='phone.devices'"], { encoding: 'utf8' })) as Array<{ payload: string }>;
const devices = records.map(row => JSON.parse(row.payload) as PhoneDevice);
const name = process.env.XOPC_PHONE_DEVICE_NAME ?? '阿里云手机';
const selected = devices.find(device => device.name === name && device.enabled && device.connection?.kind === 'aliyun-adb');
assert(selected?.connection, 'Choose an enabled registered Aliyun test phone with XOPC_PHONE_DEVICE_NAME');
const leases = JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', join(originalState, 'xopc.db'),
  "SELECT key,payload FROM durable_state WHERE namespace='phone.leases'"], { encoding: 'utf8' }) || '[]') as Array<{ key: string; payload: string }>;
assert(!leases.some(row => row.key === selected.serial && JSON.parse(row.payload).expiresAt > Date.now()), 'Test phone has an active owner');
const modelRefs = process.env.XOPC_PHONE_MODEL_REFS?.split(',').map(ref => ref.trim())
  ?? ['xopc-cloud/phone-doubao'];
assert(modelRefs.length > 0 && modelRefs.length <= 6 && modelRefs.every(ref => ref.includes('/')), 'Provide one to six provider/model references');
if (modelRefs.includes('phone-bigmodel/autoglm-phone')) assert(process.env.ZHIPU_API_KEY, 'Independent BigModel verification requires ZHIPU_API_KEY');
const trialProviders: Record<string, any> = {};
for (const [index, ref] of modelRefs.entries()) {
  if (ref.startsWith('xopc-cloud/')) continue;
  const resolved = resolveModel(ref);
  const key = await getApiKey(resolved.provider);
  assert(key, `Missing credentials for ${resolved.provider}`);
  const envKey = `XOPC_PHONE_TRIAL_KEY_${index}`;
  process.env[envKey] = key;
  trialProviders[resolved.provider] = { baseUrl: resolved.baseUrl, api: resolved.api, apiKey: envKey,
    models: [{ id: resolved.id, input: resolved.input, maxTokens: resolved.maxTokens, ...('phoneUse' in resolved ? { phoneUse: resolved.phoneUse } : {}) }] };
}
const fetched = modelRefs.some(ref => ref.startsWith('xopc-cloud/')) ? await new XopcCloudModelSource().fetch() : undefined;
const connection = new CloudAdbConnection(selected.connection.endpoint, await new PhoneCloudKeyStore().load(selected.connection.credentialId));
const driver = connection.driver();
const command = (...args: string[]) => connection.command('', ['-s', selected.serial, ...args], AbortSignal.timeout(20_000), 20_000);
const model = (await command('shell', 'getprop', 'ro.product.model')).toString().trim();
const state = await mkdtemp(join(tmpdir(), 'xopc-phone-cloud-e2e-'));
const evidence = resolve(process.env.XOPC_PHONE_EVIDENCE ?? join(tmpdir(), `xopc-phone-jd-${Date.now()}`));
await mkdir(evidence, { recursive: true });
const probe = createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
const address = probe.address(); assert(address && typeof address !== 'string');
const port = address.port; await new Promise<void>(done => probe.close(() => done()));
const gatewayToken = randomUUID(); const base = `http://127.0.0.1:${port}`;
const configPath = join(state, 'xopc.json');
Object.assign(process.env, { XOPC_STATE_DIR: state, XOPC_CONFIG_PATH: configPath, XOPC_CONFIG: configPath,
  XOPC_WORKSPACE: state, XOPC_MODELS_JSON: join(state, 'models.json'), XOPC_CREDENTIALS_DIR: credentials,
  XOPC_LOG_CONSOLE: 'false', XOPC_LOG_FILE: 'false', XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1', PI_CODING_AGENT_DIR: join(state, 'pi') });
const config = ConfigSchema.parse({ gateway: { bind: 'loopback', port, auth: { mode: 'token', token: gatewayToken } },
  phone: { enabled: true, batchReadings: true, modelRequestTimeoutMs: 120_000 }, browser: { enabled: false } });
await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
await writeFile(join(state, 'models.json'), JSON.stringify({ providers: trialProviders }), { mode: 0o600 });
closeXopcDatabase(); openXopcDatabase();
seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: 'xopc-cloud/auto' }, phoneUse: { primary: modelRefs[0] } }, tools: { phone_use: { mode: 'allow' } } }), agents: [{ id: 'main', enabled: true, workspace: state }] });
if (fetched?.status === 'fetched') {
  const store = getModelCatalogStore(); store.replaceSourceModels('xopc-cloud', fetched.source, fetched.models);
  await new ModelCatalogPersistence().save(store.getSource('xopc-cloud')!);
}
resetModelRegistry(); getModelRegistry().refresh();
const device = new PhoneRepository().save({ ...selected, name: 'Cloud model E2E test', appAccess: 'selected', allowedApps: ['com.jingdong.app.mall'] });
new PhoneRepository().setDefault(device.id);
closeXopcDatabase();
const recorderPath = join(state, 'record-model.mjs');
await writeFile(recorderPath, `import { writeFile } from 'node:fs/promises';
const nativeFetch = globalThis.fetch; let sequence = 0;
globalThis.fetch = async (url, options) => {
  if (!String(url).includes('/chat/completions') || typeof options?.body !== 'string') return nativeFetch(url, options);
  const index = ++sequence; const body = JSON.parse(options.body);
  const messages = body.messages ?? [];
  const parts = messages.flatMap(message => Array.isArray(message.content) ? message.content : []);
  const frame = parts.find(part => part.type === 'image_url')?.image_url?.url;
  if (frame?.startsWith('data:image/png;base64,')) await writeFile(${JSON.stringify(evidence)} + '/model-' + index + '.png', Buffer.from(frame.split(',')[1], 'base64'));
  const response = await nativeFetch(url, options);
  const raw = await response.clone().text();
  await writeFile(${JSON.stringify(evidence)} + '/model-' + index + '.json', JSON.stringify({ context: parts.filter(part => part.type === 'text'), response: { status: response.status, choices: JSON.parse(raw).choices?.map(choice => ({ finish_reason: choice.finish_reason, message: { content: choice.message?.content } })) } }, null, 2));
  return response;
};`);
let logs = '';
const child = spawn(process.execPath, ['--import', recorderPath, '--import', 'tsx', 'src/cli/bin.ts', 'gateway', '--port', String(port), '--bind', 'loopback', '--no-hot-reload'], { cwd: resolve('.'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout!.on('data', chunk => { logs = (logs + chunk).slice(-16_000); });
child.stderr!.on('data', chunk => { logs = (logs + chunk).slice(-16_000); });
const headers = { Authorization: `Bearer ${gatewayToken}`, 'Content-Type': 'application/json' };
async function request(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${base}${path}`, { method, headers, signal: AbortSignal.timeout(90_000), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json() as { payload?: any; error?: unknown };
  assert(response.ok, `${path}: HTTP ${response.status} ${JSON.stringify(data.error)}`); return data.payload;
}
const trials: Array<Record<string, unknown>> = [];
let sessionId: string | undefined;
const registeredDb = new DatabaseSync(join(originalState, 'xopc.db'));
const registeredLease = randomUUID();
let acquiredLease = false;
try {
  registeredDb.exec('BEGIN IMMEDIATE');
  try {
    const row = registeredDb.prepare("SELECT payload FROM durable_state WHERE namespace='phone.leases' AND scope='' AND key=?").get(selected.serial) as { payload: string } | undefined;
    assert(!row || JSON.parse(row.payload).expiresAt <= Date.now(), 'Test phone acquired another owner');
    registeredDb.prepare("INSERT INTO durable_state(namespace,scope,key,payload) VALUES('phone.leases','',?,?) ON CONFLICT(namespace,scope,key) DO UPDATE SET payload=excluded.payload")
      .run(selected.serial, JSON.stringify({ token: registeredLease, expiresAt: Date.now() + 900_000 }));
    registeredDb.exec('COMMIT'); acquiredLease = true;
  } catch (error) { registeredDb.exec('ROLLBACK'); throw error; }

  let ready = false;
  for (let attempt = 0; attempt < 240; attempt++) {
    assert.equal(child.exitCode, null, `Gateway exited: ${logs.slice(-2000)}`);
    try { const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok && (await response.json() as any).ready) { ready = true; break; } } catch {}
    await delay(250);
  }
  assert(ready, `Gateway startup failed: ${logs.slice(-2000)}`);
  assert.equal((await fetch(`${base}/api/phone/devices`)).status, 401);
  const choices = (await request('/api/phone/models')).models;
  for (const id of modelRefs) assert(choices.some((entry: any) => entry.id === id && entry.configured), `Missing configured model ${id}`);
  for (const [index, ref] of modelRefs.entries()) {
    {
      const current = await request('/api/global-defaults');
      await request('/api/global-defaults', { defaults: { ...current.defaults, models: { ...current.defaults.models, phoneUse: { primary: ref, fallbacks: [] } } }, scope: 'models', expectedModels: current.defaults.models }, 'PATCH');
    }
    const coldStart = process.env.XOPC_PHONE_COLD_START === '1';
    if (coldStart) await command('shell', 'am', 'force-stop', 'com.jingdong.app.mall');
    const started = performance.now();
    const opened = await request('/api/phone/sessions', { deviceId: device.id, mode: 'control', agentId: 'main', appPackage: 'com.jingdong.app.mall' });
    sessionId = opened.id;
    const openMs = performance.now() - started;
    const products: Array<{ name: string; price: string; introduction: string; shop?: string }> = [];
    const segments: any[] = [];
    let taskId: string | undefined;
    let report: any;
    for (let segment = 0; segment < 5 && products.length < 5; segment++) {
      await request(`/api/phone/sessions/${sessionId}/execute`, { op: 'run', taskId,
        goal: segment === 0
          ? '在京东搜索“AI 眼镜”，进入默认综合排序的商品结果页即可停止。不要滚动结果页，由主 Agent 在后续片段收集商品。只浏览，不登录、不加购、不购买。'
          : '在当前京东 AI 眼镜综合排序结果页向下滑动一次，显示后续商品即可停止。保持排序，不进入详情页。只浏览，不登录、不加购、不购买。',
        ...(segment === 0 ? { completion: { appPackage: 'com.jingdong.app.mall', textAny: ['AI 眼镜', 'AI眼镜'], textAll: ['综合'] } } : {}),
        constraints: ['只浏览，不登录、不加购、不购买，不改变综合排序'],
        requestedOutputs: [
          { key: 'products', description: '读取当前屏幕完整可见的商品卡片，按从上到下、从左到右顺序返回紧凑 JSON 数组。每项包含 name（商品名）、price（可见价格）、introduction（基于卡片可见文字的一句介绍）、shop（店铺，可缺省）。不要猜测遮挡内容，不包含半截商品，不添加当前屏幕外的商品，不输出 Markdown。控制总长度在 900 字符内。' },
          { key: 'sort', description: '当前商品排序方式；无法确认时返回 null' },
        ], maxActions: segment === 0 ? Number(process.env.XOPC_PHONE_MAX_ACTIONS ?? 8) : 1,
        ...(segment === 0 ? { budget: { maxActions: 20, maxModelRequests: 30, maxActiveDurationMs: 300000 } } : {}),
      });
      for (let poll = 0; poll < 620; poll++) {
        report = await request(`/api/phone/sessions/${sessionId}`);
        if (poll % 20 === 0) console.log(JSON.stringify({ modelRef: ref, segment, elapsedMs: Math.round(performance.now() - started), status: report.status, actions: report.actions, modelRequests: report.modelRequests }));
        if (report.status !== 'running') break;
        await delay(500);
      }
      taskId = report.task?.taskId;
      segments.push(structuredClone(report));
      const output = report.feedback?.outputs?.find((value: any) => value.key === 'products');
      if (output?.value) {
        let visible: unknown;
        try { visible = JSON.parse(output.value); } catch { visible = undefined; }
        if (Array.isArray(visible)) for (const product of visible) {
          if (typeof product?.name !== 'string' || !product.name.trim() || typeof product.price !== 'string' || !product.price.trim()) continue;
          const identity = (value: typeof product) => [value.name, value.shop ?? '', value.price].join('|').replace(/\s+/g, '').normalize('NFKC');
          if (!products.some(previous => identity(previous) === identity(product))) products.push({ name: product.name, price: product.price,
            introduction: typeof product.introduction === 'string' ? product.introduction : '', ...(typeof product.shop === 'string' ? { shop: product.shop } : {}) });
        }
      }
      if (!taskId || !['ready', 'completed'].includes(report.status) || ['user', 'inspect'].includes(report.feedback?.nextAction)) break;
      if (segment === 0 && !products.length) break;
    }
    const elapsedMs = Math.round(performance.now() - started);
    const top5 = products.slice(0, 5);
    const result = { modelRef: ref, coldStart, elapsedMs, openMs: Math.round(openMs), top5, count: top5.length, complete: top5.length === 5,
      overFiveSecondsMs: Math.max(0, elapsedMs - 5000), segments, provenance: 'Screenshot readings are unverified; inspect stored frames against the product list.' };
    await writeFile(join(evidence, `trial-${index + 1}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    trials.push({ modelRef: ref, coldStart, elapsedMs, openMs: Math.round(openMs), complete: result.complete, count: top5.length,
      actions: report.actions, modelRequests: report.modelRequests, stopReason: report.stopReason });
    await request(`/api/phone/devices/${device.id}/disconnect`, {}); sessionId = undefined;
    const final = await driver.observe(selected.serial, AbortSignal.timeout(30_000));
    await writeFile(join(evidence, `trial-${index + 1}.png`), final.frame); final.frame.fill(0);
    await driver.releaseInput();
  }
  const summary = { device: name, deviceModel: model, authenticatedGateway: true,
    stateIsolated: true, trials, note: 'Phone workflow timing starts before open and ends after collecting product outputs, includes polling overhead, and excludes Gateway boot, the pre-trial force-stop and a separate chat-model synthesis. Products and ordering require frame inspection; runtime UI verification alone is not Top5 verification.' };
  await writeFile(join(evidence, 'result.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
} catch (error) {
  await writeFile(join(evidence, 'failure.json'), JSON.stringify({ passed: false, trials, message: error instanceof Error ? error.message : String(error) }, null, 2));
  throw error;
} finally {
  if (sessionId && child.exitCode === null && child.signalCode === null) await request(`/api/phone/devices/${device.id}/disconnect`, {}).catch(() => {});
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), delay(10_000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
  await driver.releaseInput(); connection.dispose(); closeXopcDatabase();
  if (acquiredLease) registeredDb.prepare("DELETE FROM durable_state WHERE namespace='phone.leases' AND scope='' AND key=? AND json_extract(payload,'$.token')=?").run(selected.serial, registeredLease);
  registeredDb.close(); await rm(state, { recursive: true, force: true });
}
