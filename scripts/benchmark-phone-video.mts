import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { WebSocket as WebSocketType } from 'ws';
const { WebSocket } = createRequire(import.meta.url)('ws') as typeof import('ws');
import { AdbPhoneDriver, resolveAdbPath } from '../src/phone/adb-driver.js';
import { CloudAdbConnection, PhoneCloudKeyStore } from '../src/phone/cloud-adb.js';

const origin = 'http://127.0.0.1:18790';
const conversationId = process.argv[2];
if (!conversationId) throw new Error('Usage: pnpm exec tsx scripts/benchmark-phone-video.mts <paused-conversation-id> [output.json]');
const config = JSON.parse(await readFile(join(homedir(), '.xopc/xopc.json'), 'utf8'));
const clientId = randomUUID();
async function api(path: string, body?: unknown) {
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${config.gateway.auth.token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json() as { payload: any; error?: { code: string } };
  if (!response.ok) throw new Error(result.error?.code ?? `HTTP ${response.status}`); return result.payload;
}
const base = `/api/phone/conversations/${conversationId}`;
let state = await api(`${base}?clientId=${clientId}`);
if (!state || state.report.controlOwner !== 'none') throw new Error('Pause and release this test session first');
const devices = await api('/api/phone/devices'); const device = devices.devices.find((d: any) => d.id === state.report.deviceId);
const cloud = device?.connection?.kind === 'aliyun-adb' && process.env.PHONE_BENCH_CLOUD === '1';
if (!device || (!cloud && !/^emulator-\d+$/.test(device.serial)) || device.allowedApps.length !== 1 || device.allowedApps[0] !== 'com.android.settings') throw new Error('Benchmark requires a local emulator or PHONE_BENCH_CLOUD=1 for a configured Aliyun phone, scoped to Android Settings');
const session = `${base}/${state.report.sessionId}`;
const command = async (op: string, extra: Record<string, unknown> = {}) => { state = await api(`${session}/control`, { clientId, operationId: randomUUID(), epoch: state.report.controlEpoch, op, ...extra }); };
let cloudConnection: CloudAdbConnection | undefined;
let ws: WebSocketType | undefined; let heartbeat: ReturnType<typeof setInterval> | undefined;
const report: Record<string, unknown> = { measuredAt: new Date().toISOString(), conversationId, sessionId: state.report.sessionId, transport: 'scrcpy-h264', textOrPixelsRecorded: false };
try {
  const ticket = await api(`${session}/video-ticket`, { clientId });
  const started = performance.now();
  ws = new WebSocket(origin.replace('http:', 'ws:') + ticket.path, ['xopc-phone-v1', ticket.ticket], { origin });
  let geometry = 0; let frames = 0; let seq = 0; let firstAt = 0;
  let queuedMove: [number, number] | undefined; let heldPointer = false; let coalescedMoves = 0;
  const pointer = (phase: string, x: number, y: number) => {
    if (phase === 'down') heldPointer = true;
    if (phase === 'up') { heldPointer = false; queuedMove = undefined; }
    if (phase === 'move' && sent.size) { queuedMove = [x, y]; coalescedMoves++; return; }
    const id = ++seq; sent.set(id, performance.now()); ws!.send(JSON.stringify({ type: 'pointer', phase, seq: id, epoch: state.report.controlEpoch, geometry, x, y }));
  };
  const arrivals: number[] = []; const ack: number[] = []; const sent = new Map<number, number>();
  let first!: () => void; const ready = new Promise<void>(resolve => { first = resolve; });
  ws.on('message', (data, binary) => {
    if (binary) { const buffer = Buffer.from(data as Buffer); if (!(buffer[0] & 1)) { frames++; arrivals.push(performance.now()); if (!firstAt) { firstAt = performance.now(); first(); } } return; }
    const message = JSON.parse(data.toString());
    if (message.type === 'geometry') geometry = message.version;
    if (message.type === 'fault') console.error('Video fault:', message.code);
    if (message.type === 'ack') {
      const at = sent.get(message.seq); if (at !== undefined) { ack.push(performance.now() - at); sent.delete(message.seq); }
      if (!sent.size && heldPointer && queuedMove) { const p = queuedMove; queuedMove = undefined; pointer('move', ...p); }
    }
  });
  await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('No video first frame')), 8000).unref())]);
  report.firstPacketMs = Math.round(firstAt - started);
  const at = performance.now(); await command('takeover'); report.takeoverMs = Math.round(performance.now() - at);
  heartbeat = setInterval(() => { ws?.send(JSON.stringify({ type: 'ping' })); void command('heartbeat'); }, 4000);
  if (cloud) cloudConnection = new CloudAdbConnection(device.connection.endpoint, await new PhoneCloudKeyStore().load(device.connection.credentialId));
  const driver = cloudConnection?.driver() ?? new AdbPhoneDriver(resolveAdbPath(config.phone.adbPath));
  await command('recover', { action: { type: 'launch', package: 'com.android.settings' } });
  const before = await driver.observe(device.serial, AbortSignal.timeout(15_000)); before.frame.fill(0);
  const layout = (observation: typeof before) => JSON.stringify(observation.elements.filter(n => n.text && !n.password).map(n => [n.resourceId, n.text, n.bounds]));
  const upward = process.env.PHONE_BENCH_DIRECTION === 'up';
  const y = (i: number) => upward ? 800 - i * 13 : 250 + i * 13;
  const moveStarted = performance.now(); pointer('down', 500, y(0));
  for (let i = 1; i <= 40; i++) { await new Promise(r => setTimeout(r, 25)); pointer('move', 500, y(i)); }
  const moveEnded = performance.now();
  // Observe before UP: the screen must already have scrolled during the live gesture.
  const held = await driver.observe(device.serial, AbortSignal.timeout(15_000)); held.frame.fill(0);
  report.screenChangedBeforeUp = layout(before) !== layout(held);
  pointer('up', 500, y(40));
  for (let i = 0; sent.size && i < 100; i++) await new Promise(r => setTimeout(r, 25));
  report.coalescedMoves = coalescedMoves;
  const activeFrames = arrivals.filter(at => at >= moveStarted && at <= moveEnded).length;
  report.motionArrivalOffsetsMs = arrivals.filter(at => at >= moveStarted && at <= moveEnded).map(at=>Math.round(at-moveStarted));
  report.motionFrames = activeFrames; report.motionDurationMs = Math.round(moveEnded - moveStarted);
  report.motionPacketFps = Number((activeFrames * 1000 / (moveEnded - moveStarted)).toFixed(1));
  ack.sort((a, b) => a - b); report.inputAckSamples = ack.length;
  report.inputAckMedianMs = Number((ack[Math.floor(ack.length / 2)] ?? 0).toFixed(2));
  report.inputAckP95Ms = Number((ack[Math.ceil(ack.length * .95) - 1] ?? 0).toFixed(2));
  report.frames = frames; report.unacknowledged = sent.size;
  report.measurementLimits = 'ACK means written to the persistent scrcpy transport, not Android injection confirmation. FPS counts encoded video packets, not browser presentation. Screen movement was checked before UP; glass-to-glass P95 is not measured.';
} finally {
  clearInterval(heartbeat); try { await command('release'); } catch { /* A refused channel already releases control. */ } finally { ws?.close(); cloudConnection?.dispose(); }
}
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
