/** Opt-in acceptance with a real Cloud access token and disposable application state. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

assert.equal(process.env.XOPC_CLOUD_ONBOARDING_LIVE, '1', 'Set XOPC_CLOUD_ONBOARDING_LIVE=1 to authorize real service usage');
const sourceRoot = process.env.XOPC_STATE_DIR ?? join(homedir(), '.xopc');
const sourceConfig = process.env.XOPC_CONFIG_PATH ?? join(sourceRoot, 'xopc.json');
const sourceOAuth = join(process.env.XOPC_CREDENTIALS_DIR ?? join(sourceRoot, 'credentials'), 'oauth', 'xopc-cloud.json');
const fingerprint = () => [sourceConfig, sourceOAuth].map(path => createHash('sha256').update(readFileSync(path)).digest('hex'));
const originalHashes = fingerprint();
const oauth = JSON.parse(readFileSync(sourceOAuth, 'utf8'));
assert.ok(oauth.access && oauth.expiresAt > Date.now() + 120_000, 'A current Cloud access token with at least two minutes remaining is required');
const directory = mkdtempSync(join(tmpdir(), 'xopc-cloud-onboarding-live-'));
const configPath = join(directory, 'xopc.json');
const workspace = join(directory, 'workspace');
mkdirSync(join(directory, 'credentials', 'oauth'), { recursive: true, mode: 0o700 });
// Never clone refresh tokens: this isolated run cannot rotate the user's credentials.
const { refresh: _refresh, ...accessOnly } = oauth;
writeFileSync(join(directory, 'credentials', 'oauth', 'xopc-cloud.json'), JSON.stringify(accessOnly), { mode: 0o600 });
for (const [key, value] of Object.entries({ XOPC_STATE_DIR: directory, XOPC_CONFIG_PATH: configPath,
  XOPC_CONFIG: configPath, XOPC_CREDENTIALS_DIR: join(directory, 'credentials'), XOPC_WORKSPACE: workspace,
  XOPC_LOG_DIR: join(directory, 'logs'), XOPC_LOG_LEVEL: 'fatal', XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1' })) process.env[key] = value;
const reportPath = resolve(process.env.XOPC_CLOUD_ONBOARDING_REPORT ?? 'docs/design/technical/cloud-onboarding-live-2026-10-15.json');
const results: Array<{ name: string; passed: boolean; durationMs: number; details?: unknown; error?: string }> = [];
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), authentication: 'existing real account; access token only; no OAuth browser reauthorization', results };
async function check(name: string, operation: () => Promise<unknown>) {
  const start = Date.now();
  try {
    const details = await operation();
    results.push({ name, passed: true, durationMs: Date.now() - start, details });
  } catch (error) {
    results.push({ name, passed: false, durationMs: Date.now() - start, error: error instanceof Error ? error.message : String(error) });
  }
  console.log(JSON.stringify(results.at(-1)));
}
const { ConfigSchema } = await import('../src/config/schema.js');
const { saveConfig } = await import('../src/config/loader.js');
const { initWorkspaceCore } = await import('../src/cli/utils/init-workspace-core.js');
const { AgentCatalogRepository } = await import('../src/agent-catalog/repository.js');
const { AgentCatalogService } = await import('../src/agent-catalog/service.js');
const { closeXopcDatabase } = await import('../src/storage/sqlite/index.js');
const { getXopcCloudCatalogCoordinator } = await import('../src/providers/xopc-cloud-catalog-coordinator.js');
const { getModelCatalogStore } = await import('../src/providers/model-catalog-store.js');
const { applyXopcCloudCapabilitySetup } = await import('../src/gateway/xopc-cloud-capability-setup.js');
let gatewayServer: import('../src/gateway/server.js').GatewayServer | undefined;
try {
  const portListener = createServer();
  await new Promise<void>(done => portListener.listen(0, '127.0.0.1', done));
  const port = (portListener.address() as { port: number }).port;
  await new Promise<void>(done => portListener.close(() => done()));
  const initialized = await initWorkspaceCore({ configPath, workspacePath: workspace, gatewayPort: port, persistWorkspacePath: true });
  const base = ConfigSchema.parse({ ...initialized.config, userContext: { ...initialized.config.userContext, enabled: false } });
  const repository = new AgentCatalogRepository();
  const catalogService = new AgentCatalogService(repository);
  const baseDefaults = structuredClone(repository.getSettings().defaults);
  const catalog = await getXopcCloudCatalogCoordinator().refresh('oauth');
  assert.equal(catalog.state, 'ready', JSON.stringify(catalog.error));
  const source = getModelCatalogStore().getSource('xopc-cloud')!;
  report.catalog = { count: catalog.modelCount, models: source.models.map(model => ({ id: model.id, kind: model.kind, available: model.availability, voiceModes: model.voice?.modes, voiceServiceVersion: model.voice?.serviceVersion })) };
  let fresh = base;
  await check('fresh-onboarding-configuration', async () => {
    const result = await applyXopcCloudCapabilitySetup({ currentConfig: base, saveConfig: async next => { fresh = next; await saveConfig(next, configPath); return { saved: true }; } });
    assert.equal(result.configured, true);
    assert.equal(fresh.tools.media?.audio?.enabled, true);
    assert.equal(fresh.messages?.tts?.enabled, true);
    assert.equal(fresh.voice?.realtime.enabled, true);
    assert.ok(fresh.voice?.realtime.stt && fresh.voice.realtime.tts && fresh.voice.realtime.omni);
    return { result, models: repository.getSettings().defaults.models, realtime: fresh.voice?.realtime };
  });
  const freshDefaults = structuredClone(repository.getSettings().defaults);
  await check('idempotent-onboarding', async () => {
    let repeated = fresh;
    await applyXopcCloudCapabilitySetup({ currentConfig: fresh, saveConfig: async next => { repeated = next; return { saved: true }; } });
    assert.deepEqual(repeated, fresh);
    assert.deepEqual(repository.getSettings().defaults, freshDefaults);
  });
  await check('cli-and-gateway-configuration-equivalence', async () => {
    catalogService.updateDefaults(baseDefaults);
    const { setPrimaryModel } = await import('../src/cli/commands/onboard/model.js');
    const cli = await setPrimaryModel(base, workspace, freshDefaults.models.chat.primary);
    assert.deepEqual(cli.tools.media, fresh.tools.media);
    assert.deepEqual(cli.messages, fresh.messages);
    assert.deepEqual(cli.voice, fresh.voice);
    assert.deepEqual(repository.getSettings().defaults.models, freshDefaults.models);
  });
  await check('explicit-settings-preserved-with-real-catalog', async () => {
    const explicit = ConfigSchema.parse({ ...base,
      tools: { ...base.tools, media: { audio: { enabled: false, provider: 'xopc-local' } } },
      messages: { tts: { enabled: false, provider: 'edge', trigger: 'inbound' } },
      voice: { realtime: { enabled: false, tts: { provider: 'alibaba', model: 'my-model', voice: 'my-voice' } } },
    });
    catalogService.updateDefaults({ ...freshDefaults, models: { ...freshDefaults.models,
      chat: { primary: 'custom/offline', fallbacks: [] }, imageUnderstanding: { primary: 'custom/vision', fallbacks: [] },
      imageGeneration: { primary: 'custom/image', fallbacks: [], autoProviderFallback: false },
    } });
    const before = structuredClone(repository.getSettings().defaults);
    let after = explicit;
    const result = await applyXopcCloudCapabilitySetup({ currentConfig: explicit, saveConfig: async next => { after = next; await saveConfig(next, configPath); return { saved: true }; } });
    assert.equal(result.configured, true);
    assert.deepEqual(after, explicit);
    assert.deepEqual(ConfigSchema.parse(JSON.parse(readFileSync(configPath, 'utf8'))), explicit);
    assert.deepEqual(repository.getSettings().defaults, before);
    return { chat: before.models.chat.primary, voiceEnabled: after.voice?.realtime.enabled, sttEnabled: after.tools.media?.audio?.enabled, ttsEnabled: after.messages?.tts?.enabled };
  });
  catalogService.updateDefaults(freshDefaults);
  await saveConfig(fresh, configPath);
  const { GatewayServer } = await import('../src/gateway/server.js');
  gatewayServer = new GatewayServer({ configPath, enableHotReload: false, port, bind: 'loopback', bindHost: '127.0.0.1' });
  await gatewayServer.start();
  const headers = { Authorization: `Bearer ${initialized.token}`, 'Content-Type': 'application/json' };
  const origin = `http://127.0.0.1:${port}`;
  async function request(path: string, body?: unknown) {
    const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90_000) });
    assert.ok(response.ok, `${path}: ${response.status}: ${response.ok ? '' : await response.text()}`);
    return response;
  }
  await check('authenticated-gateway-voice-readiness', async () => {
    assert.equal((await fetch(origin + '/api/voice/realtime/status')).status, 401);
    const { payload } = await (await request('/api/voice/realtime/status')).json() as any;
    for (const mode of ['dictation', 'assistant', 'natural']) assert.equal(payload.capabilities[mode].available, true, mode);
    return payload;
  });
  const { resolveModel } = await import('../src/providers/index.js');
  const { completeWithResolvedCredentials } = await import('../src/providers/model-call.js');
  await check('real-default-chat-model', async () => {
    const model = resolveModel(freshDefaults.models.chat.primary);
    const answer = await completeWithResolvedCredentials(model, { messages: [{ role: 'user', content: 'Reply with exactly CLOUD_ONBOARDING_OK.', timestamp: Date.now() }] },
      { maxTokens: 80, signal: AbortSignal.timeout(60_000) }, undefined, { operation: 'cloud_onboarding_live', trigger: 'other' });
    assert.ok(!answer.errorMessage, answer.errorMessage);
    const text = answer.content.flatMap(item => item.type === 'text' ? [item.text] : []).join('');
    assert.ok(text.includes('CLOUD_ONBOARDING_OK'), text);
    return { model: freshDefaults.models.chat.primary, text };
  });
  let image: { buffer: Buffer; mimeType: string } | undefined;
  await check('real-image-generation', async () => {
    const { generateImage } = await import('../src/agent/image/generation/runtime.js');
    const result = await generateImage({ cfg: fresh, agentId: 'main', modelConfig: freshDefaults.models.imageGeneration,
      prompt: 'A single solid red circle on a plain white background. No words or text.', count: 1, timeoutMs: 120_000 });
    assert.equal(result.provider, 'xopc-cloud');
    image = result.images[0];
    assert.ok(image?.buffer.length);
    return { provider: result.provider, model: result.model, imageBytes: image.buffer.length, mimeType: image.mimeType };
  });
  await check('real-image-understanding', async () => {
    assert.ok(image, 'Image generation did not return a fixture');
    const model = resolveModel(freshDefaults.models.imageUnderstanding!.primary);
    const answer = await completeWithResolvedCredentials(model, { messages: [{ role: 'user', timestamp: Date.now(), content: [
      { type: 'text', text: 'Describe the main color and shape in this image in one short sentence.' },
      { type: 'image', data: image.buffer.toString('base64'), mimeType: image.mimeType },
    ] }] }, { maxTokens: 150, signal: AbortSignal.timeout(60_000) }, undefined, { operation: 'cloud_onboarding_vision_live', trigger: 'other' });
    assert.ok(!answer.errorMessage, answer.errorMessage);
    const text = answer.content.flatMap(item => item.type === 'text' ? [item.text] : []).join('');
    assert.match(text, /\bred\b|\bpink\b|红|粉/i);
    assert.match(text, /circle|circular|round|圆/i);
    return { model: freshDefaults.models.imageUnderstanding!.primary, text };
  });
  const wavPath = join(directory, 'speech.wav');
  const pcmPath = join(directory, 'speech.pcm');
  await check('real-cloud-text-to-speech', async () => {
    const response = await request('/api/voice/speech', { text: '你好，请只回答语音测试成功。', language: 'zh' });
    assert.equal(response.headers.get('x-voice-provider'), 'xopc-cloud');
    const audio = Buffer.from(await response.arrayBuffer());
    assert.ok(audio.length > 1000);
    const inputPath = join(directory, 'speech-audio');
    writeFileSync(inputPath, audio);
    const convert = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', inputPath, '-ar', '16000', '-ac', '1', wavPath]);
    assert.equal(convert.status, 0, convert.stderr?.toString());
    const pcm = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', wavPath, '-f', 's16le', '-ar', '16000', '-ac', '1', 'pipe:1']);
    assert.equal(pcm.status, 0);
    const padded = Buffer.concat([pcm.stdout, Buffer.alloc(32_000 * 3)]);
    writeFileSync(pcmPath, Buffer.concat([padded, Buffer.alloc((640 - padded.length % 640) % 640)]));
    return { bytes: audio.length, format: response.headers.get('content-type'), provider: response.headers.get('x-voice-provider') };
  });
  await check('real-cloud-speech-recognition', async () => {
    const form = new FormData();
    form.set('audio', new Blob([readFileSync(wavPath)], { type: 'audio/wav' }), 'speech.wav');
    form.set('language', 'zh');
    const response = await fetch(origin + '/api/voice/transcriptions', { method: 'POST', headers: { Authorization: headers.Authorization }, body: form, signal: AbortSignal.timeout(60_000) });
    const data = await response.json() as any;
    assert.ok(response.ok, JSON.stringify(data));
    assert.match(JSON.stringify(data), /语音|测试|成功/);
    return data;
  });
  async function probe(script: string, args: string[]) {
    const child = spawn(process.execPath, [...(script.endsWith('.mts') || script.endsWith('.ts') ? ['--import', 'tsx'] : []), script, ...args], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout!.on('data', data => { output += data; });
    child.stderr!.on('data', data => { output += data; });
    const timer = setTimeout(() => child.kill('SIGTERM'), 130_000);
    const [code] = await once(child, 'exit');
    clearTimeout(timer);
    assert.equal(code, 0, output.slice(-6000));
    return output.split('\n').filter(line => line.startsWith('{')).map(line => { try { return JSON.parse(line); } catch { return undefined; } }).filter(Boolean);
  }
  await check('real-stt-agent-tts-websocket-roundtrip', () => probe('scripts/probe-gateway-voice-e2e.ts', [pcmPath, 'main', '1']));
  await check('real-natural-voice-websocket-roundtrip', () => probe('scripts/probe-gateway-voice-e2e.ts', [pcmPath, 'main', '1', 'natural']));
  await check('real-react-browser-capture-and-playback', () => probe('scripts/voice-browser-live.mjs', [pcmPath, 'main']));
} catch (error) {
  report.fatalError = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await gatewayServer?.stop().catch(() => {});
  closeXopcDatabase();
  report.originalConfigAndCredentialsUnchanged = JSON.stringify(originalHashes) === JSON.stringify(fingerprint());
  report.completedAt = new Date().toISOString();
  report.passed = !report.fatalError && results.every(result => result.passed) && report.originalConfigAndCredentialsUnchanged;
  mkdirSync(resolve(reportPath, '..'), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  rmSync(directory, { recursive: true, force: true });
  console.log(JSON.stringify({ reportPath, passed: report.passed, fatalError: report.fatalError, originalConfigAndCredentialsUnchanged: report.originalConfigAndCredentialsUnchanged }));
  if (!report.passed) process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
