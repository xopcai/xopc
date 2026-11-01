import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { DesktopIdentityStore } from '../electron/desktop/device-identity.js';
import { DesktopDeviceAuth } from '../electron/desktop/device-auth.js';
import { desktopAuthTransport } from '../electron/desktop/device-transport.js';
import { DesktopObservationManager } from '../electron/desktop/observation-manager.js';
import { GatewayConnectionPreview } from '../electron/gateway/connection-manager.js';
import { ConnectionCredentialStore } from '../electron/gateway/credentials.js';
import { ConnectionProfileStore } from '../electron/gateway/profiles.js';
import { createAcceptanceOutput, localConnectionEnvironment, withTimeout } from './electron-local-connection-support.mjs';
import { macPackagedTarget, packagedGatewayEnvironment } from './electron-packaged-acceptance.mjs';

const root = process.cwd(), index = process.argv.indexOf('--app'); assert(index >= 0);
const target = await macPackagedTarget(process.argv[index + 1]);
const output = await createAcceptanceOutput(join(root, 'reports/desktop-screen-agent.json'));
const state = await mkdtemp(join(tmpdir(), 'xopc-screen-agent-')), token = randomUUID();
const report: any = { passed: false, scope: 'Actual bundled Gateway/Agent/HTTP/Endpoint pipeline. Node Host uses injected synthetic capture and test-only encryption; no native consent or safeStorage claim.', requests: [], shapes: [] };
let expectedImageHash: string | undefined;
let approveCapture = !process.argv.includes('--cancel-first'), completedRejectedTurn = false;
let child: ReturnType<typeof spawn> | undefined, observer: DesktopObservationManager | undefined;
let channel: ReturnType<typeof desktopAuthTransport> | undefined, inferenceError: string | undefined, imageSeen = false;
const until = async (probe: () => Promise<boolean> | boolean, ms = 30000) => { const end = Date.now() + ms; do { if (inferenceError) throw new Error(inferenceError); if (await probe()) return; await delay(100); } while (Date.now() < end); throw new Error('Screen Agent acceptance timed out'); };
const inference = http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const b of req) chunks.push(b);
    const body = JSON.parse(Buffer.concat(chunks).toString()), messages = body.messages ?? [], names = (body.tools ?? []).map((t: any) => t.function.name);
    const lastUser = messages.findLastIndex((m: any) => m.role === 'user' && JSON.stringify(m.content).includes('Use the explicit desktop screenshot'));
    const resultCount = messages.slice(lastUser + 1).filter((m: any) => m.role === 'tool').length;
    const images = messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).filter((p: any) => p.type === 'image_url');
    for (const image of images) { const bytes = Buffer.from(image.image_url.url.split(',')[1], 'base64'); const hash = createHash('sha256').update(bytes).digest('hex'); assert.equal(hash, expectedImageHash, 'Image pixels changed in model transport'); report.receivedImageHash = hash; }
    imageSeen ||= images.length > 0;
    report.requests.push({ model: body.model, tools: names, resultCount, images: images.length, disabled: JSON.stringify(messages).includes('Image reading is disabled.'), attached: JSON.stringify(messages).includes('(see attached image)') });
    let tool;
    if (names.length && !resultCount) tool = { name: 'tool_search', arguments: JSON.stringify({ query: 'desktop screenshot capture', limit: 5 }) };
    else if (names.length && resultCount === 1) { const name = names.find((n: string) => n.startsWith('device__desktop_screen_capture_')); assert(name); tool = { name, arguments: '{}' }; }
    else if (names.length && resultCount >= 2 && !imageSeen) { if (approveCapture) inferenceError = 'Tool image absent from actual model request'; else completedRejectedTurn = true; }
    const chunk = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'chat', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(chunk({ role: 'assistant' }) + (tool ? chunk({ tool_calls: [{ index: 0, id: process.argv.includes('--reuse-call-ids') ? 'call-' + resultCount : 'call-' + randomUUID(), type: 'function', function: tool }] }) + chunk({}, 'tool_calls') : chunk({ content: 'IMAGE_OK' }) + chunk({}, 'stop')) + 'data: [DONE]\n\n');
  } catch (error) { inferenceError = String(error); res.writeHead(500).end('{}'); }
}).listen(0, '127.0.0.1');
try {
  await once(inference, 'listening');
  const probe = http.createServer().listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = (probe.address() as any).port; await new Promise<void>(resolve => probe.close(() => resolve()));
  const serverState = join(state, 'server'); await mkdir(serverState);
  const config = join(serverState, 'xopc.json');
  await writeFile(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port, auth: { mode: 'token', token } }, browser: { enabled: false }, userContext: { enabled: false } }), { mode: 0o600 });
  await writeFile(join(serverState, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${(inference.address() as any).port}/v1`, apiKey: 'synthetic', api: 'openai-completions', models: [{ id: 'chat', name: 'Fixture', input: ['text', 'image'], reasoning: false, contextWindow: 128000, maxTokens: 2000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
  const env = packagedGatewayEnvironment(localConnectionEnvironment(process.env, root, serverState, config, join(serverState, 'workspace')), target);
  Object.assign(env, { XOPC_LOG_LEVEL: 'debug', XOPC_LOG_CONSOLE: 'true', XOPC_LOG_LLM_PAYLOAD: 'true' });
  child = spawn(target.executablePath, [target.server, 'gateway', '--foreground', '--bind', 'loopback', '--port', String(port), '--no-hot-reload'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout!, child.stderr!]) { let pending = ''; stream.on('data', chunk => { pending += String(chunk); if (pending.length > 4000000) { pending = ''; return; } let end; while ((end = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, end); pending = pending.slice(end + 1); try { const log = JSON.parse(line); if (log.effectiveContext) report.shapes.push({ modelRef: log.modelRef, images: log.effectiveContext.messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).filter((p: any) => p.type === 'image').length, roles: log.effectiveContext.messages.map((m: any) => m.role) }); } catch {} } }); }
  const origin = `http://127.0.0.1:${port}`;
  const owner = async (path: string, method = 'GET', body?: unknown) => { const res = await fetch(origin + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) }); assert(res.ok, path + ': ' + res.status); const json = await res.json() as any; return json.payload ?? json; };
  await until(() => owner('/api/desktop-host/compatibility').then(() => true).catch(() => false), 60000);
  const defaults = (await owner('/api/global-defaults')).defaults; defaults.models.chat = { primary: 'fixture/chat', fallbacks: [] }; await owner('/api/global-defaults', 'PATCH', { defaults, scope: 'models' });
  const agents = await owner('/api/agents'), agentId = agents.defaultId ?? agents.agents[0].id;
  await owner('/api/agents/' + agentId, 'PATCH', { models: { chat: { primary: 'fixture/chat', fallbacks: [] } }, runtime: { codemode: { enabled: true } } });
  const encryption = { available: async () => true, encrypt: async (value: string) => Buffer.from(value), decrypt: async (value: Buffer) => value.toString() };
  const manager = new GatewayConnectionPreview(new ConnectionProfileStore(join(state, 'profiles')), new ConnectionCredentialStore(join(state, 'credentials'), encryption));
  await manager.initialize(); const saved = await manager.save(0, { name: 'API fixture', origin, transport: 'ssh', credential: token }); const id = saved.profiles[0].id; await manager.select(saved.epoch, id);
  const identity = await owner('/api/desktop-host/compatibility'); await manager.pinIdentity(manager.snapshot().epoch, id, { gatewayId: identity.gatewayId, publicKey: identity.publicKey });
  const binding = { profileId: id, origin, gatewayId: identity.gatewayId, publicKey: identity.publicKey }, store = new DesktopIdentityStore(join(state, 'identities'), encryption);
  channel = desktopAuthTransport(binding, 'ssh'); const auth = new DesktopDeviceAuth(binding, store, channel.request);
  await auth.enroll({ displayName: 'Synthetic screen fixture', consent: async () => true, setup: async () => (await owner('/api/desktop-host/pairing-setups', 'POST', { sshOrigin: origin })).invitation,
    approve: async (requestId, revision) => { await owner('/api/device-pairing/requests/' + requestId + '/decision', 'POST', { decision: 'approve', expectedRevision: revision }); } });
  const image = process.argv.includes('--noisy') ? await sharp(randomBytes(256 * 256 * 3), { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer() : await sharp({ create: { width: 256, height: 256, channels: 3, background: '#123456' } }).png().toBuffer();
  report.imageBytes = image.length; expectedImageHash = createHash('sha256').update(image).digest('hex');
  observer = new DesktopObservationManager({ manager, store, appVersion: 'fixture', visible: () => true, consent: async () => false, readState: async () => { throw Error('No state tool'); }, selectScreen: async () => ({ foreground: () => true, confirm: async () => approveCapture, capture: async () => Buffer.from(image) }) });
  await observer.start(manager.snapshot().epoch, id, 'screen'); await until(() => Boolean(observer?.origin()));
  const conversationId = randomUUID(); await owner(`/api/sessions/${conversationId}/inputs`, 'POST', { clientMessageId: randomUUID(), input: { content: 'Use the explicit desktop screenshot first.' }, origin: await observer.readyOrigin(), kind: 'start', creation: { agentId, projectId: null, execution: null, temporary: false, model: 'fixture/chat', thinkingLevel: 'off' } });
  if (process.argv.includes('--cancel-first')) {
    await until(() => completedRejectedTurn); assert(!imageSeen);
    approveCapture = true;
    const session = await owner('/api/sessions/' + conversationId), configuration = await owner('/api/sessions/' + conversationId + '/agent-config');
    await owner('/api/sessions/' + conversationId + '/inputs', 'POST', { clientMessageId: randomUUID(), input: { content: 'Use the explicit desktop screenshot approve.' }, origin: await observer.readyOrigin(), kind: 'append', expectedTranscriptId: session.session.transcriptId, configVersion: configuration.configVersion, delivery: 'next' });
  }
  await until(() => imageSeen); report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  observer?.stop(); await observer?.whenStopped(); channel?.close(); inference.closeAllConnections(); await new Promise<void>(resolve => inference.close(() => resolve()));
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); try { await withTimeout(exited, 10000, 'Fixture shutdown timed out'); } catch { child.kill('SIGKILL'); await exited; report.cleanupFailure = true; report.passed = false; process.exitCode = 1; } }
  if (report.passed) await rm(state, { recursive: true, force: true }); else report.failureStateDirectory = state;
  await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
