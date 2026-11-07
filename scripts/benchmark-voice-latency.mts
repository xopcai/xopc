/** Live PCM benchmark. Measures from the last voiced input frame, not the delayed ASR final. */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { decodeVoiceAudioFrame, encodeVoiceUplinkAudioFrame } from '@xopcai/realtime-protocol/voice';

const [file, agentId = 'main', count = '5', existingConversation] = process.argv.slice(2);
const rounds = Number(count);
if (!file || !Number.isInteger(rounds) || rounds < 1 || rounds > 30) {
  throw new Error('Usage: benchmark-voice-latency.mts PCM16_16KHZ_FILE [AGENT_ID] [ROUNDS=5] [EXISTING_CONVERSATION_ID]');
}
const input = readFileSync(file);
let first = -1, last = 0;
for (let offset = 0; offset + 640 <= input.length; offset += 640) {
  let energy = 0;
  for (let i = offset; i < offset + 640; i += 2) energy += input.readInt16LE(i) ** 2;
  if (Math.sqrt(energy / 320) >= 100) { if (first < 0) first = offset; last = offset + 640; }
}
if (first < 0) throw new Error('Fixture has no voiced PCM frames');
const audio = input.subarray(Math.max(0, first - 3200), last);
const config = JSON.parse(readFileSync(process.env.XOPC_CONFIG_PATH ?? process.env.XOPC_CONFIG
  ?? join(homedir(), '.xopc', 'xopc.json'), 'utf8'));
const base = `http://127.0.0.1:${config.gateway.port}`;
const headers = { Authorization: `Bearer ${config.gateway.auth.token}`, 'Content-Type': 'application/json' };
async function request(path: string, method = 'GET', body?: object) {
  const response = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(`${path}: ${response.status}: ${JSON.stringify(result.error)}`);
  return result.payload ?? result;
}
const conversationId = existingConversation ?? crypto.randomUUID();
const samples: Array<Record<string, number>> = [];
let socket: WebSocket | undefined;
let session: { sessionId: string; ticket: string; websocketPath: string } | undefined;
let epoch = 0, seq = 0, failure: Error | undefined;
let taskId: string | undefined;
let taskFinished = true;
let active: { end: number; stopped?: number; created?: number; text?: number; audio?: number; done?: number; bytes: number } | undefined;
const send = (type: string, payload: object) => socket!.send(JSON.stringify({ protocolVersion: 3,
  messageId: crypto.randomUUID(), sentAt: Date.now(), type, payload }));
async function waitFor(condition: () => boolean, ms: number) {
  const deadline = performance.now() + ms;
  while (!condition() && !failure && performance.now() < deadline) await delay(10);
  if (failure) throw failure;
  if (!condition()) throw new Error('Voice benchmark timed out');
}
try {
  if (!existingConversation) {
    const agents = await request('/api/agents');
    const model = agents.agents.find((agent: { id: string }) => agent.id === agentId)?.effective?.models?.chat?.primary;
    if (!model) throw new Error('Agent model unavailable');
    const body = { commandId: crypto.randomUUID(), purpose: 'voice',
      creation: { agentId, projectId: null, execution: null, temporary: true, model, thinkingLevel: 'off' } };
    let ready = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      const result = await request(`/api/sessions/${conversationId}/materialize`, 'POST', body);
      if (result.receipt?.lifecycle === 'ready') { ready = true; break; }
      await delay(1000);
    }
    if (!ready) throw new Error('Diagnostic conversation did not become ready');
  }
  session = await request('/api/voice/realtime/sessions', 'POST', {
    purpose: 'conversation', mode: 'assistant', conversationId, language: 'zh',
    supportedProtocolVersions: [3], mediaPreferences: ['websocket-pcm'],
  });
  socket = new WebSocket(base.replace('http:', 'ws:') + session!.websocketPath);
  socket.on('error', error => { failure = error; });
  socket.on('close', (code, reason) => { failure ??= new Error(`Voice socket closed: ${code} ${reason.toString()}`); });
  socket.on('message', (data, binary) => {
    if (binary) {
      const frame = decodeVoiceAudioFrame(data as Buffer);
      if (!active) return;
      if (active.audio === undefined) {
        active.audio = performance.now();
        console.log(JSON.stringify({ stage: 'first_audio', round: samples.length + 1,
          speechEndToAudioMs: Math.round(active.audio - active.end) }));
      }
      active.bytes += frame.audio.length;
      // Simulates an immediately draining sink, so this is network receipt, not acoustic playback.
      send('response.audio.played', { responseId: frame.responseId, playedDurationMs: Math.floor(active.bytes / 48) });
      return;
    }
    const event = JSON.parse(data.toString());
    if (event.type === 'session.ready') epoch = event.payload.connectionEpoch;
    if (event.type === 'session.error') failure = new Error(`${event.payload.code}: ${event.payload.message}`);
    if (!active) return;
    if (event.type === 'task.created') { taskId = event.payload.taskId; taskFinished = false; }
    if (event.type === 'task.done' && taskId === event.payload.taskId) taskFinished = true;
    if (event.type === 'input.speech_stopped') active.stopped = performance.now();
    if (event.type === 'response.created') active.created = performance.now();
    if (event.type === 'response.text.delta') active.text ??= performance.now();
    if (event.type === 'response.done') {
      if (!active.bytes || !event.payload.audio) failure = new Error('Reply completed without audio');
      active.done = performance.now();
    }
  });
  await once(socket, 'open');
  send('session.start', { sessionId: session!.sessionId, ticket: session!.ticket });
  await waitFor(() => epoch !== 0, 40_000);
  console.log(JSON.stringify({ stage: 'ready', conversation: existingConversation ? 'existing' : 'disposable', fixtureMs: audio.length / 32 }));
  for (let round = 0; round < rounds; round++) {
    seq = 0;
    const started = performance.now();
    active = { end: started + audio.length / 32, bytes: 0 };
    const utteranceId = crypto.randomUUID();
    // Keep feeding silence while waiting for ASR and the reply, as a live microphone does.
    for (let offset = 0; !active.done; offset += 640) {
      if (failure) throw failure;
      if (performance.now() - started > 60_000) throw new Error('Voice response timed out');
      await delay(Math.max(0, started + offset / 32 - performance.now()));
      const frame = offset < audio.length ? audio.subarray(offset, offset + 640) : Buffer.alloc(640);
      socket.send(encodeVoiceUplinkAudioFrame({ connectionEpoch: epoch, utteranceId, audioSeq: ++seq,
        capturedAtMonotonicMs: performance.now(), durationMs: 20, audio: frame }));
      if (offset + 640 === audio.length) active.end = performance.now();
    }
    if (failure) throw failure;
    const sample = { round: round + 1, speechEndToAudioMs: Math.round(active.audio! - active.end),
      speechEndToTextMs: Math.round(active.text! - active.end),
      speechEndToAsrStopMs: Math.round(active.stopped! - active.end),
      asrStopToResponseMs: Math.round(active.created! - active.stopped!),
      responseToTextMs: Math.round(active.text! - active.created!),
      textToAudioMs: Math.round(active.audio! - active.text!), audioBytes: active.bytes };
    if (Object.values(sample).some(value => !Number.isFinite(value))) throw new Error('Incomplete timing sample');
    samples.push(sample);
    console.log(JSON.stringify(sample));
    active = undefined;
    await delay(400);
  }
  const values = samples.map(sample => sample.speechEndToAudioMs).sort((a, b) => a - b);
  const percentile = (p: number) => values[Math.ceil(values.length * p) - 1];
  console.log(JSON.stringify({ measurement: 'Last voiced PCM frame sent to first audio received; excludes physical playback.',
    rounds: samples.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: values.at(-1),
    targetMs: 1500, withinTarget: values.filter(value => value <= 1500).length }));
} finally {
  if (taskId && !taskFinished && socket?.readyState === WebSocket.OPEN) {
    send('task.cancel', { taskId });
    const deadline = performance.now() + 5000;
    while (!taskFinished && performance.now() < deadline && socket.readyState === WebSocket.OPEN) await delay(20);
  }
  if (socket?.readyState === WebSocket.OPEN) send('session.stop', { reason: 'user_finished' });
  socket?.terminate();
  if (session) await request('/api/voice/realtime/sessions/cancel', 'POST', { sessionId: session.sessionId, ticket: session.ticket }).catch(() => undefined);
  if (!existingConversation && taskFinished) await request(`/api/sessions/${conversationId}`, 'DELETE').catch(() => undefined);
  else if (!existingConversation) console.error(`Diagnostic conversation retained for unfinished task: ${conversationId}`);
}
