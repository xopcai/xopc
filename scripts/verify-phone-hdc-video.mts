/** Isolated USB H.264 / control acceptance. No LLM requests or retained screen pixels. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { serve } from '@hono/node-server';
import { ConfigSchema } from '../src/config/schema.js';
import { AgentDefaultsSchema } from '../src/agent-config/schema.js';
import { seedTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { closeXopcDatabase, openXopcDatabase } from '../src/storage/sqlite/connection.js';
import { createConversation } from '../src/storage/sqlite/conversation-repository.js';
import { getSessionMetadata } from '../src/storage/sqlite/session-repository.js';
import { getAllModels } from '../src/providers/index.js';
import { getPhoneRuntime, phoneExecutionContext } from '../src/phone/runtime.js';
import { phoneModelProfile } from '../src/phone/model-adapter.js';
import { PhoneStreamGateway } from '../src/phone/stream-gateway.js';
import { createHonoApp } from '../src/gateway/hono/app.js';
import type { GatewayService } from '../src/gateway/service.js';

const { WebSocket } = createRequire(import.meta.url)('ws') as typeof import('ws');
const state = await mkdtemp(join(tmpdir(), 'xopc-hdc-video-acceptance-'));
Object.assign(process.env, { XOPC_STATE_DIR: state, XOPC_WORKSPACE: state, XOPC_LOG_CONSOLE: 'false', XOPC_LOG_FILE: 'false', OPENAI_API_KEY: 'isolated-video-test-no-model-calls' });
openXopcDatabase({ path: ':memory:' });
const model = getAllModels().find(model => model.provider === 'openai' && phoneModelProfile(model)); assert(model);
const modelRef = `${model.provider}/${model.id}`;
seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: { primary: modelRef }, phoneUse: { primary: modelRef } }, tools: { phone_use: { mode: 'allow' } } }), agents: [{ id: 'main', enabled: true, workspace: state }] });
const token = randomUUID(); const clientId = randomUUID();
const config = ConfigSchema.parse({ phone: { enabled: true, hdcPath: process.env.XOPC_PHONE_HDC_PATH, hdcVideo: { sdkJar: process.env.XOPC_PHONE_HDC_SDK_JAR } }, gateway: { auth: { mode: 'token', token } } });
const runtime = getPhoneRuntime(); const streams = new PhoneStreamGateway();
const app = createHonoApp({ service: { currentConfig: config, isGatewayReady: () => true, getExtensionLoader: () => null,
  getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token, phoneStreams: streams,
  sessions: { emit: () => {}, getSession: async (id: string) => getSessionMetadata(id) } } as unknown as GatewayService });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
server.on('upgrade', (request, socket, head) => streams.handleUpgrade(request, socket, head));
if (!server.listening) await once(server, 'listening');
const address = server.address(); assert(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const sockets: import('ws').WebSocket[] = [];
async function request(path: string, body?: unknown) {
  const response = await fetch(`${origin}/api/phone${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  const data = await response.json(); assert(response.ok, `${path}: ${response.status} ${JSON.stringify(data.error)}`); return data.payload;
}
let browser: import('playwright-core').Browser | undefined;
try {
  assert.equal((await fetch(`${origin}/api/phone/devices?platform=harmonyos`)).status, 401);
  const discovery = await request('/devices?platform=harmonyos');
  const target = discovery.discovery.find((phone: { serial: string; state: string }) => phone.state === 'device' && (!process.env.XOPC_PHONE_HDC_SERIAL || phone.serial === process.env.XOPC_PHONE_HDC_SERIAL)); assert(target);
  const device = await request('/devices', { platform: 'harmonyos', serial: target.serial, name: 'Video acceptance', appAccess: 'all', allowedApps: [], textInput: 'manual' });
  const owner = createConversation({ agentId: 'main', sourceChannel: 'webchat', sourceChatId: 'webchat' }).key;
  const context = phoneExecutionContext(config, 'main');
  const report = await runtime.execute(owner, { op: 'open', deviceId: device.id, mode: 'control' }, context) as { sessionId: string; controlEpoch: number };
  const base = `/conversations/${owner}/${report.sessionId}`;
  let live = await request(`/conversations/${owner}?clientId=${clientId}`); assert.equal(live.media, 'hdc-h264');
  const openSocket = async (purpose: 'view' | 'control') => {
    const ticket = await request(`${base}/video-ticket`, { clientId, purpose });
    const ws = new WebSocket(origin.replace('http:', 'ws:') + ticket.path, ['xopc-phone-v1', ticket.ticket], { origin }); sockets.push(ws);
    return ws;
  };
  const packets: Buffer[] = []; let geometry: { version: number; width: number; height: number; codec: string } | undefined;
  let codecConfig: Buffer | undefined; let frames = 0;
  const viewer = await openSocket('view');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No H.264 video through Gateway')), 45_000);
    viewer.on('error', reject);
    viewer.on('message', (data, binary) => {
      if (!binary) { const message = JSON.parse(data.toString()); if (message.type === 'geometry') geometry = message; if (message.type === 'fault') reject(new Error(message.code)); return; }
      const bytes = Buffer.from(data as Buffer);
      if (bytes[0] & 1) codecConfig = Buffer.from(bytes.subarray(32));
      else { frames++; if (bytes[0] & 2 && packets.length < 4) packets.push(Buffer.from(bytes.subarray(32))); }
      if (frames >= 5 && geometry && codecConfig && packets.length) { clearTimeout(timer); resolve(); }
    });
  });
  const control = async (op: string, extra = {}) => request(`${base}/control`, { clientId, operationId: randomUUID(), epoch: live.report.controlEpoch, op, ...extra });
  live = await control('takeover'); assert(live.ownControl); const humanEpoch = live.report.controlEpoch;
  const ws = await openSocket('control'); const acks = new Set<number>();
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Control stream not ready')), 10_000); ws.on('error', reject); ws.on('message', (data, binary) => { if (!binary) { const message = JSON.parse(data.toString()); if (message.type === 'ack') acks.add(message.seq); if (message.type === 'ready') { clearTimeout(timer); resolve(); } } }); });
  const waitAck = async (seq: number) => { const deadline = Date.now() + 15_000; while (!acks.has(seq)) { assert(Date.now() < deadline, 'Pointer was not acknowledged'); await new Promise(resolve => setTimeout(resolve, 30)); } };
  let seq = 0;
  const pointer = (phase: 'down' | 'up' | 'cancel') => { const id = ++seq; ws.send(JSON.stringify({ type: 'pointer', phase, seq: id, epoch: humanEpoch, geometry: geometry!.version, x: 500, y: 50, ...(phase === 'up' ? { durationMs: 120 } : {}) })); return id; };
  await waitAck(pointer('down')); await waitAck(pointer('cancel'));
  live = await request(`/conversations/${owner}?clientId=${clientId}`); assert.equal(live.report.humanActions ?? 0, 0);
  let inputs = 0;
  if (process.argv.includes('--input')) {
    live = await control('recover', { action: { type: 'launch', package: 'com.huawei.hmos.settings' } });
    await waitAck(pointer('down')); await waitAck(pointer('up')); inputs++;
    live = await request(`/conversations/${owner}?clientId=${clientId}`); assert.equal(live.report.humanActions, 2); // launch + one completed gesture
    live = await control('input', { action: { type: 'back' }, geometry: geometry!.version });
  }
  live = await control('handback'); assert.equal(live.ownControl, false); assert(live.report.controlEpoch > humanEpoch);
  const before = live.report.actions;
  const closed = once(ws, 'close'); pointer('down'); await closed;
  live = await request(`/conversations/${owner}?clientId=${clientId}`); assert.equal(live.report.actions, before); assert.equal(live.report.modelRequests, 0);
  let decodedFrames = 0;
  if (process.argv.includes('--browser')) {
    const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core'); browser = await chromium.launch({ channel: 'chrome', headless: true }); const page = await browser.newPage();
    await page.addInitScript('globalThis.__name = (value) => value;');
    await page.goto(`${origin}/api/health`);
    decodedFrames = await page.evaluate(async ({ geometry, config, frames }) => {
      return await new Promise<number>((resolve, reject) => {
        let count = 0; const timer = setTimeout(() => reject(new Error('WebCodecs produced no frame')), 5000);
        const decoder = new VideoDecoder({ output: frame => { count++; frame.close(); }, error: reject });
        decoder.configure({ codec: geometry.codec, optimizeForLatency: true });
        frames.forEach((frame, index) => { const data = new Uint8Array(config.length + frame.length); data.set(config); data.set(frame, config.length); decoder.decode(new EncodedVideoChunk({ type: 'key', timestamp: index * 100_000, data })); });
        decoder.flush().then(() => { clearTimeout(timer); decoder.close(); resolve(count); }, reject);
      });
    }, { geometry: geometry!, config: [...codecConfig!], frames: packets.map(packet => [...packet]) });
    assert(decodedFrames > 0);
  }
  console.log(JSON.stringify({ passed: true, authenticatedH264: true, geometry, frames, decodedFrames, cancelDidNotExecute: true, handbackFencedOldSocket: true, completedInputs: inputs, modelRequests: 0 }));
  codecConfig?.fill(0); for (const packet of packets) packet.fill(0);
} finally {
  for (const socket of sockets) socket.terminate(); streams.close(); await browser?.close(); await runtime.shutdown();
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); closeXopcDatabase(); await rm(state, { recursive: true, force: true });
}
