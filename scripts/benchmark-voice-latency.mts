/** Live PCM benchmark. Measures from the last voiced input frame, not the delayed ASR final. */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { decodeVoiceAudioFrame, encodeVoiceUplinkAudioFrame, type CreateVoiceSessionResponse } from '@xopcai/realtime-protocol/voice';

const [file, agentId = 'main', count = '5', existingConversation] = process.argv.slice(2);
const rounds = Number(count);
const mode = process.env.XOPC_VOICE_BENCHMARK_MODE ?? 'auto';
const naturalBackend = process.env.XOPC_VOICE_BENCHMARK_BACKEND;
const expectAction = process.env.XOPC_VOICE_BENCHMARK_ACTION === '1';
const cancelAfterMs = Number(process.env.XOPC_VOICE_BENCHMARK_CANCEL_AFTER_MS);
const interruptReply = process.env.XOPC_VOICE_BENCHMARK_INTERRUPT === '1';
const normalizeTranscript = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const expectedTranscript = normalizeTranscript(process.env.XOPC_VOICE_BENCHMARK_EXPECT_TRANSCRIPT ?? '');
let cancelTimer: ReturnType<typeof setTimeout> | undefined;
if (!['auto', 'assistant', 'natural'].includes(mode) || (naturalBackend && naturalBackend !== 'higgs')) throw new Error('Invalid benchmark mode/backend');
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
let session: CreateVoiceSessionResponse | undefined;
let epoch = 0, seq = 0, failure: Error | undefined;
let taskId: string | undefined;
let taskFinished = true;
let interruptedReply = false;
let active: { end: number; inputComplete?: boolean; started?: number; stopped?: number; final?: number; transcripts: string[];
  committed?: number; created?: number; text?: number; audio?: number; done?: number;
  submitted?: number; taskDone?: number; resultResponseId?: string; bytes: number } | undefined;
const playedBytes = new Map<string, number>();
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
    purpose: 'conversation', ...(mode === 'auto' ? {} : { mode }), ...(naturalBackend ? { naturalBackend } : {}), conversationId, language: 'zh',
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
        if (!active.inputComplete) {
          failure = new Error('Reply started before the diagnostic utterance ended; split input is not a valid latency sample');
          return;
        }
        active.audio = performance.now();
        console.log(JSON.stringify({ stage: 'first_audio', round: samples.length + 1,
          speechEndToAudioMs: Math.round(active.audio - active.end) }));
      }
      if (interruptReply && taskId && !taskFinished && !interruptedReply) {
        interruptedReply = true;
        send('response.stop_playback', { responseId: frame.responseId });
        console.log(JSON.stringify({ stage: 'playback_interrupted', taskWasRunning: true }));
      }
      active.bytes += frame.audio.length;
      // Simulates an immediately draining sink, so this is network receipt, not acoustic playback.
      const bytes = (playedBytes.get(frame.responseId) ?? 0) + frame.audio.length;
      playedBytes.set(frame.responseId, bytes);
      send('response.audio.played', { responseId: frame.responseId, playedDurationMs: Math.floor(bytes / 48) });
      return;
    }
    const event = JSON.parse(data.toString());
    if (event.type === 'session.ready') epoch = event.payload.connectionEpoch;
    if (event.type === 'session.error') failure = new Error(`${event.payload.code}: ${event.payload.message}`);
    if (!active) return;
    if (event.type === 'task.created') {
      clearTimeout(cancelTimer);
      taskId = event.payload.taskId; taskFinished = false; active.submitted ??= performance.now();
      console.log(JSON.stringify({ stage: 'task_submitted', speechEndToTaskSubmittedMs: Math.round(active.submitted - active.end) }));
      if (Number.isFinite(cancelAfterMs) && cancelAfterMs >= 0) cancelTimer = setTimeout(() => {
        if (taskId && !taskFinished) send('task.cancel', { taskId });
      }, cancelAfterMs);
    }
    if (event.type === 'task.done' && taskId === event.payload.taskId) {
      clearTimeout(cancelTimer);
      taskFinished = true; active.taskDone = performance.now();
      console.log(JSON.stringify({ stage: 'task_done', status: event.payload.status, speechEndToTaskDoneMs: Math.round(active.taskDone - active.end) }));
    }
    if (event.type === 'input.speech_started') active.started ??= performance.now();
    if (event.type === 'input.speech_stopped') active.stopped = performance.now();
    if (event.type === 'input.transcript.final') {
      active.final = performance.now();
      active.transcripts.push(event.payload.text);
    }
    if (event.type === 'turn.committed') {
      if (!active.inputComplete || active.committed !== undefined) {
        failure = new Error('Diagnostic utterance was committed early or more than once');
        return;
      }
      if (expectedTranscript && !normalizeTranscript(active.transcripts.join('')).includes(expectedTranscript)) {
        failure = new Error('Finalized input did not contain the expected transcript');
        return;
      }
      active.committed = performance.now();
      console.log(JSON.stringify({ stage: 'input_committed', round: samples.length + 1,
        speechEndToFinalMs: active.final === undefined ? null : Math.round(active.final - active.end),
        speechEndToCommitMs: Math.round(active.committed - active.end), finalTranscripts: active.transcripts.length }));
    }
    if (event.type === 'response.created') active.created ??= performance.now();
    if (event.type === 'response.text.delta') active.text ??= performance.now();
    if (event.type === 'response.audio.started' && active.taskDone) active.resultResponseId = event.payload.responseId;
    if (event.type === 'response.done') {
      if (session?.route.engine === 'omni' && (!event.payload.audio || (expectAction && event.payload.responseId !== active.resultResponseId))) return;
      if (!active.bytes || !event.payload.audio) failure = new Error('Reply completed without audio');
      active.done = performance.now();
    }
  });
  await once(socket, 'open');
  send('session.start', { sessionId: session!.sessionId, ticket: session!.ticket });
  await waitFor(() => epoch !== 0, 40_000);
  console.log(JSON.stringify({ stage: 'ready', mode: session!.mode ?? mode, route: session!.route, naturalBackend,
    expectAction, conversation: existingConversation ? 'existing' : 'disposable', fixtureMs: audio.length / 32 }));
  for (let round = 0; round < rounds; round++) {
    interruptedReply = false;
    seq = 0;
    const started = performance.now();
    active = { end: started + audio.length / 32, bytes: 0, transcripts: [] };
    const utteranceId = crypto.randomUUID();
    // Keep feeding silence while waiting for ASR and the reply, as a live microphone does.
    for (let offset = 0; !active.done; offset += 640) {
      if (failure) throw failure;
      if (performance.now() - started > 60_000) throw new Error('Voice response timed out');
      await delay(Math.max(0, started + offset / 32 - performance.now()));
      const frame = offset < audio.length ? audio.subarray(offset, offset + 640) : Buffer.alloc(640);
      socket.send(encodeVoiceUplinkAudioFrame({ connectionEpoch: epoch, utteranceId, audioSeq: ++seq,
        capturedAtMonotonicMs: performance.now(), durationMs: 20, audio: frame }));
      if (offset + 640 === audio.length) { active.end = performance.now(); active.inputComplete = true; }
    }
    if (failure) throw failure;
    if (active.final === undefined || active.committed === undefined || active.started === undefined) {
      throw new Error('Reply completed without a confirmed input turn');
    }
    const sample = { round: round + 1, speechEndToAudioMs: Math.round(active.audio! - active.end),
      speechStartToDetectedMs: Math.round(active.started - started - Math.min(first, 3200) / 32),
      speechEndToTextMs: Math.round(active.text! - active.end),
      speechEndToAsrStopMs: Math.round(active.stopped! - active.end),
      speechEndToFinalMs: Math.round(active.final - active.end),
      finalToCommitMs: Math.round(active.committed - active.final),
      commitToTextMs: Math.round(active.text! - active.committed),
      asrStopToResponseMs: Math.round(active.created! - active.stopped!),
      responseToTextMs: Math.round(active.text! - active.created!), finalTranscripts: active.transcripts.length,
      textToAudioMs: Math.round(active.audio! - active.text!), audioBytes: active.bytes,
      ...(active.submitted ? { speechEndToTaskSubmittedMs: Math.round(active.submitted - active.end) } : {}),
      ...(active.taskDone ? { speechEndToTaskDoneMs: Math.round(active.taskDone - active.end) } : {}) };
    if (Object.values(sample).some(value => !Number.isFinite(value))) throw new Error('Incomplete timing sample');
    samples.push(sample);
    console.log(JSON.stringify(sample));
    active = undefined;
    await delay(400);
  }
  const values = samples.map(sample => sample.speechEndToAudioMs).sort((a, b) => a - b);
  const percentile = (sorted: number[], p: number) => sorted[Math.ceil(sorted.length * p) - 1];
  const stages = Object.fromEntries(['speechStartToDetectedMs', 'speechEndToFinalMs', 'finalToCommitMs', 'commitToTextMs', 'textToAudioMs'].map((stage) => {
    const sorted = samples.map(sample => sample[stage]!).sort((a, b) => a - b);
    return [stage, { p50: percentile(sorted, 0.5), p75: percentile(sorted, 0.75), p95: percentile(sorted, 0.95) }];
  }));
  console.log(JSON.stringify({ measurement: 'Last voiced PCM frame sent to first audio received; excludes physical playback.',
    rounds: samples.length, p50Ms: percentile(values, 0.5), p75Ms: percentile(values, 0.75), p95Ms: percentile(values, 0.95), maxMs: values.at(-1), stages,
    targetMs: 1500, withinTarget: values.filter(value => value <= 1500).length }));
} finally {
  clearTimeout(cancelTimer);
  if (taskId && !taskFinished && socket?.readyState === WebSocket.OPEN) {
    send('task.cancel', { taskId });
    const deadline = performance.now() + 5000;
    while (!taskFinished && performance.now() < deadline && socket.readyState === WebSocket.OPEN) await delay(20);
  }
  if (socket?.readyState === WebSocket.OPEN) send('session.stop', { reason: 'user_finished' });
  socket?.terminate();
  if (session) await request('/api/voice/realtime/sessions/cancel', 'POST', { sessionId: session.sessionId, ticket: session.ticket }).catch(() => undefined);
  if (!existingConversation && process.env.XOPC_VOICE_BENCHMARK_KEEP === '1') console.log(JSON.stringify({ stage: 'retained_conversation', conversationId }));
  else if (!existingConversation && taskFinished) await request(`/api/sessions/${conversationId}`, 'DELETE').catch(() => undefined);
  else if (!existingConversation) console.error(`Diagnostic conversation retained for unfinished task: ${conversationId}`);
}
