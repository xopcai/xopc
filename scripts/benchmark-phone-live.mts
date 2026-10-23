/** Measures the authenticated manual-control path on an already-paused emulator chat. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const conversationId = process.argv[2];
assert(conversationId && /^[\da-f]{8}-[\da-f-]{27}$/i.test(conversationId), 'Usage: node --import tsx scripts/benchmark-phone-live.mts <paused-conversation-id> [output.json]');
const config = JSON.parse(await readFile(process.env.XOPC_CONFIG_PATH ?? process.env.XOPC_CONFIG ?? join(homedir(), '.xopc/xopc.json'), 'utf8'));
const origin = `http://127.0.0.1:${config.gateway?.port ?? 18790}`;
const headers = { Authorization: `Bearer ${config.gateway.auth.token}`, 'Content-Type': 'application/json' };
const clientId = randomUUID();
type State = { report: { sessionId: string; deviceId: string; controlEpoch: number; controlOwner: string; status: string }; ownControl: boolean };
const samples: Array<{ op: string; ms: number; http: number; bytes?: number; seq?: number }> = [];
const base = `/api/phone/conversations/${conversationId}`;
let state: State | undefined;
async function request<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const start = performance.now();
  const response = await fetch(origin + path, { headers, signal: AbortSignal.timeout(30_000), ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const result = await response.json() as { payload: T; error?: { code?: string } };
  samples.push({ op: String(body?.op ?? 'status'), ms: Math.round(performance.now() - start), http: response.status });
  assert(response.ok, `Request failed: HTTP ${response.status} ${result.error?.code ?? ''}`);
  return result.payload;
}
async function control(op: string, extra: Record<string, unknown> = {}) {
  assert(state);
  state = await request<State>(`${base}/${state.report.sessionId}/control`, { clientId, epoch: state.report.controlEpoch, operationId: randomUUID(), op, ...extra });
}
try {
  state = await request<State>(`${base}?clientId=${clientId}`);
  assert(state?.report.status === 'paused' && state.report.controlOwner === 'none', 'Pause and release the phone in chat before measuring');
  const devices = await request<{ devices: Array<{ id: string; serial: string; allowedApps: string[] }> }>('/api/phone/devices');
  const device = devices.devices.find(device => device.id === state!.report.deviceId);
  assert(device && /^emulator-\d+$/.test(device.serial) && device.allowedApps.length === 1 && device.allowedApps[0] === 'com.android.settings', 'Use a local emulator restricted to Android Settings');
  await control('takeover');
  for (let index = 0; index < 3; index++) {
    const start = performance.now();
    const response = await fetch(`${origin}${base}/${state!.report.sessionId}/frame`, { headers, signal: AbortSignal.timeout(30_000) });
    const bytes = await response.arrayBuffer();
    const seq = Number(response.headers.get('X-Phone-Frame-Seq'));
    samples.push({ op: 'frame', ms: Math.round(performance.now() - start), http: response.status, seq, bytes: bytes.byteLength });
    assert(response.ok && seq > 0, 'No authorized screen frame');
    // This benchmark injects three taps in the Settings header, not a business task.
    await control('input', { frameSeq: seq, action: { type: 'tap', point: [500, 70] } });
  }
} finally {
  if (state?.ownControl) await control('release');
  const result = { at: new Date().toISOString(), conversationId, metric: 'HTTP acknowledgement, not display latency', samples };
  await writeFile(process.argv[3] ?? '/tmp/xopc-phone-live-benchmark.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
