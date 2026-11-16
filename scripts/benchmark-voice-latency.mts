/** Live PCM benchmark. Measures from the last voiced input frame, not the delayed ASR final. */
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import WebSocket from 'ws';
import { decodeVoiceAudioFrame, encodeVoiceUplinkAudioFrame, type CreateVoiceSessionResponse } from '@xopcai/realtime-protocol/voice';

const [file, agentId = 'main', count = '5', existingConversation] = process.argv.slice(2);
const rounds = Number(count);
const mode = process.env.XOPC_VOICE_BENCHMARK_MODE ?? 'auto';
const route = process.env.XOPC_VOICE_BENCHMARK_ROUTE ?? 'local';
const includePreflight = process.env.XOPC_VOICE_BENCHMARK_PREFLIGHT === '1';
const naturalBackend = process.env.XOPC_VOICE_BENCHMARK_BACKEND;
const expectAction = process.env.XOPC_VOICE_BENCHMARK_ACTION === '1';
const cancelAfterMs = Number(process.env.XOPC_VOICE_BENCHMARK_CANCEL_AFTER_MS);
const interruptReply = process.env.XOPC_VOICE_BENCHMARK_INTERRUPT === '1';
const normalizeTranscript = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const transcriptAnchors = (value: string | undefined) => (value ?? '').split('|').map(normalizeTranscript).filter(Boolean);
const expectedTranscript = transcriptAnchors(process.env.XOPC_VOICE_BENCHMARK_EXPECT_TRANSCRIPT);
const expectedBargeTranscript = transcriptAnchors(process.env.XOPC_VOICE_BENCHMARK_EXPECT_BARGE_TRANSCRIPT);
const bargeFile = process.env.XOPC_VOICE_BENCHMARK_BARGE_AUDIO;
const bargeFollowUp = process.env.XOPC_VOICE_BENCHMARK_BARGE_FOLLOW_UP === '1';
let cancelTimer: ReturnType<typeof setTimeout> | undefined;
if (!['auto', 'assistant', 'natural'].includes(mode) || (naturalBackend && naturalBackend !== 'higgs') ||
    !['local', 'frp'].includes(route)) throw new Error('Invalid benchmark mode/backend/route');
if (!file || !Number.isInteger(rounds) || rounds < 0 || rounds > 30) {
  throw new Error('Usage: benchmark-voice-latency.mts PCM16_16KHZ_FILE [AGENT_ID] [ROUNDS=5, 0=dial-only] [EXISTING_CONVERSATION_ID]');
}
if (bargeFile && (mode !== 'assistant' || interruptReply || expectAction || Number.isFinite(cancelAfterMs))) {
  throw new Error('Microphone interruption requires assistant mode without injected playback or task cancellation');
}
if (!bargeFile && (bargeFollowUp || expectedBargeTranscript.length)) {
  throw new Error('Interruption assertions require a microphone PCM fixture');
}

function loadAudio(path: string) {
  const input = readFileSync(path);
  let first = -1, last = 0;
  for (let offset = 0; offset + 640 <= input.length; offset += 640) {
    let energy = 0;
    for (let i = offset; i < offset + 640; i += 2) energy += input.readInt16LE(i) ** 2;
    if (Math.sqrt(energy / 320) >= 100) { if (first < 0) first = offset; last = offset + 640; }
  }
  if (first < 0) throw new Error('Fixture has no voiced PCM frames');
  return { audio: input.subarray(Math.max(0, first - 3200), last), leadingSilenceMs: Math.min(first, 3200) / 32 };
}

function matchesTranscript(transcripts: string[], anchors: string[]) {
  const text = normalizeTranscript(transcripts.join(''));
  let offset = 0;
  for (const anchor of anchors) {
    const found = text.indexOf(anchor, offset);
    if (found < 0) return false;
    offset = found + anchor.length;
  }
  return true;
}

const { audio, leadingSilenceMs } = loadAudio(file);
const bargeAudio = bargeFile ? loadAudio(bargeFile) : undefined;
const verifyTurns = Boolean(expectedTranscript.length || bargeAudio);
const silence = Buffer.alloc(640);
const config = JSON.parse(readFileSync(process.env.XOPC_CONFIG_PATH ?? process.env.XOPC_CONFIG
  ?? join(homedir(), '.xopc', 'xopc.json'), 'utf8'));
let base = `http://127.0.0.1:${config.gateway.port ?? 18790}`;
const headers = { Authorization: `Bearer ${process.env.XOPC_GATEWAY_TOKEN || config.gateway.auth.token}`, 'Content-Type': 'application/json' };
async function request(path: string, method = 'GET', body?: object) {
  const response = await fetch(base + path, { method, headers, redirect: 'error',
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(`${path.replace(/\/sessions\/[^/]+/, '/sessions/:id')}: ${response.status}: ${result.error?.code ?? 'request_failed'}`);
  return result.payload ?? result;
}
if (route === 'frp') {
  const tunnel = await request('/api/tunnel/status');
  const origin = new URL(tunnel.publicUrl);
  if (tunnel.state !== 'connected' || origin.protocol !== 'https:' || origin.username || origin.password ||
      origin.port || !/^[a-z0-9]{4,16}\.frp\.xopc\.ai$/.test(origin.hostname)) {
    throw new Error('An active official FRP tunnel is required');
  }
  base = origin.origin;
}
const conversationId = existingConversation ?? crypto.randomUUID();
const samples: Array<Record<string, number>> = [];
let socket: WebSocket | undefined;
let session: CreateVoiceSessionResponse | undefined;
let epoch = 0, seq = 0, failure: Error | undefined;
let readyAt = 0;
let taskId: string | undefined;
let taskFinished = true;
let interruptedReply = false;
type BargeSample = { offset?: number; started?: number; inputComplete?: boolean; cancelled?: number;
  final?: number; committed?: number; transcripts: string[]; done?: number; bytes: number; responseId?: string };
let active: { end: number; inputComplete?: boolean; started?: number; stopped?: number; final?: number; transcripts: string[];
  committed?: number; created?: number; text?: number; audio?: number; done?: number;
  submitted?: number; taskDone?: number; resultResponseId?: string; bytes: number;
  heardResponseId?: string; commits: number; delegated: number; barge?: BargeSample } | undefined;
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
    const model = process.env.XOPC_VOICE_BENCHMARK_MODEL ??
      agents.agents.find((agent: { id: string }) => agent.id === agentId)?.effective?.models?.chat?.primary;
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
  const sessionRequest = {
    purpose: 'conversation', ...(mode === 'auto' ? {} : { mode }), ...(naturalBackend ? { naturalBackend } : {}), conversationId, language: 'zh',
    supportedProtocolVersions: [3], mediaPreferences: ['websocket-pcm'],
  };
  const dialStartedAt = performance.now();
  if (includePreflight) await request('/api/voice/realtime/preflight', 'POST', sessionRequest);
  const ticketStartedAt = performance.now();
  session = await request('/api/voice/realtime/sessions', 'POST', sessionRequest);
  const ticketReadyAt = performance.now();
  socket = new WebSocket(base.replace(/^http/, 'ws') + session!.websocketPath, { handshakeTimeout: 15_000 });
  socket.on('error', error => { failure = error; });
  socket.on('close', (code, reason) => { failure ??= new Error(`Voice socket closed: ${code} ${reason.toString()}`); });
  socket.on('message', (data, binary) => {
    if (binary) {
      const frame = decodeVoiceAudioFrame(data as Buffer);
      if (!active) return;
      const barge = active.barge;
      if (active.audio === undefined) {
        if (!active.inputComplete) {
          failure = new Error('Reply started before the diagnostic utterance ended; split input is not a valid latency sample');
          return;
        }
        active.audio = performance.now();
        active.heardResponseId = frame.responseId;
        console.log(JSON.stringify({ stage: 'first_audio', round: samples.length + 1,
          speechEndToAudioMs: Math.round(active.audio - active.end) }));
      }
      if (interruptReply && taskId && !taskFinished && !interruptedReply) {
        interruptedReply = true;
        send('response.stop_playback', { responseId: frame.responseId });
        console.log(JSON.stringify({ stage: 'playback_interrupted', taskWasRunning: true }));
      }
      if (barge?.responseId === frame.responseId) barge.bytes += frame.audio.length;
      else active.bytes += frame.audio.length;
      // Simulates an immediately draining sink, so this is network receipt, not acoustic playback.
      const bytes = (playedBytes.get(frame.responseId) ?? 0) + frame.audio.length;
      playedBytes.set(frame.responseId, bytes);
      // Pace the original response during interruption tests so the user speaks into active playback.
      if (!barge || frame.responseId !== active.heardResponseId) {
        send('response.audio.played', { responseId: frame.responseId, playedDurationMs: Math.floor(bytes / 48) });
      }
      return;
    }
    const event = JSON.parse(data.toString());
    if (event.type === 'session.ready') { epoch = event.payload.connectionEpoch; readyAt = performance.now(); }
    if (event.type === 'session.error') failure = new Error(`${event.payload.code}: ${event.payload.message}`);
    if (!active) return;
    const barge = active.barge;
    if (event.type === 'task.created') {
      active.delegated += 1;
      if (verifyTurns && session?.route.engine === 'agent' && active.delegated > (bargeFollowUp ? 2 : 1)) {
        failure = new Error('More Agent tasks than expected');
      }
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
    if (event.type === 'input.speech_stopped' && barge?.started === undefined) active.stopped = performance.now();
    if (event.type === 'input.transcript.final') {
      const inputTurn = barge?.started === undefined ? active : barge;
      inputTurn.final = performance.now();
      inputTurn.transcripts.push(event.payload.text);
    }
    if (event.type === 'turn.committed') {
      active.commits += 1;
      const isFollowUp = barge?.started !== undefined;
      const inputTurn = isFollowUp ? barge : active;
      if (!inputTurn.inputComplete || inputTurn.committed !== undefined || (isFollowUp && !bargeFollowUp)) {
        const cause = isFollowUp && !bargeFollowUp ? 'stop-only interruption submitted an Agent turn'
          : inputTurn.committed !== undefined ? 'input committed more than once' : 'input committed before the last voiced frame';
        failure = new Error(`Diagnostic turn failed: ${cause}`);
        return;
      }
      if (!matchesTranscript(inputTurn.transcripts, isFollowUp ? expectedBargeTranscript : expectedTranscript)) {
        failure = new Error('Finalized input did not contain the expected transcript');
        return;
      }
      inputTurn.committed = performance.now();
      if (!isFollowUp) console.log(JSON.stringify({ stage: 'input_committed', round: samples.length + 1,
        speechEndToFinalMs: active.final === undefined ? null : Math.round(active.final - active.end),
        speechEndToCommitMs: Math.round(inputTurn.committed - active.end), finalTranscripts: active.transcripts.length }));
    }
    if (event.type === 'response.created') {
      if (barge?.committed !== undefined) barge.responseId ??= event.payload.responseId;
      else active.created ??= performance.now();
    }
    if (event.type === 'response.text.delta' && event.payload.delta?.trim()) active.text ??= performance.now();
    if (event.type === 'response.audio.started' && active.taskDone) active.resultResponseId = event.payload.responseId;
    if (event.type === 'response.cancelled' && barge && event.payload.responseId === active.heardResponseId && event.payload.reason === 'barge_in') {
      barge.cancelled ??= performance.now();
    }
    if (event.type === 'response.done') {
      if (session?.route.engine === 'omni' && (!event.payload.audio || (expectAction && event.payload.responseId !== active.resultResponseId))) return;
      if (barge) {
        if (event.payload.responseId === barge.responseId && barge.bytes && event.payload.audio) barge.done = performance.now();
        else if (!barge.cancelled || event.payload.responseId !== active.heardResponseId) {
          failure = new Error('Playback ended without the expected microphone interruption');
        }
        return;
      }
      if (!active.bytes || !event.payload.audio) failure = new Error('Reply completed without audio');
      active.done = performance.now();
    }
  });
  await once(socket, 'open');
  send('session.start', { sessionId: session!.sessionId, ticket: session!.ticket });
  await waitFor(() => epoch !== 0, 40_000);
  console.log(JSON.stringify({ stage: 'ready', mode: session!.mode ?? mode, route: session!.route, naturalBackend,
    expectAction, conversation: existingConversation ? 'existing' : 'disposable', fixtureMs: audio.length / 32,
    transportRoute: route, preflightMs: Math.round(ticketStartedAt - dialStartedAt), issueMs: Math.round(ticketReadyAt - ticketStartedAt),
    socketReadyMs: Math.round(readyAt - ticketReadyAt), dialToReadyMs: Math.round(readyAt - dialStartedAt) }));
  for (let round = 0; round < rounds; round++) {
    interruptedReply = false;
    seq = 0;
    const started = performance.now();
    const barge = bargeAudio ? { transcripts: [], bytes: 0 } as BargeSample : undefined;
    active = { end: started + audio.length / 32, bytes: 0, transcripts: [], commits: 0, delegated: 0, barge };
    const utteranceId = crypto.randomUUID();
    let quietUntil = Infinity;
    // Keep feeding silence while waiting for ASR and the reply, as a live microphone does.
    for (let offset = 0; performance.now() < quietUntil; offset += 640) {
      if (failure) throw failure;
      if (performance.now() - started > 60_000) throw new Error('Voice response timed out');
      await delay(Math.max(0, started + offset / 32 - performance.now()));
      let frame = offset < audio.length ? audio.subarray(offset, offset + 640) : silence;
      if (barge && bargeAudio && active.audio !== undefined && performance.now() - active.audio >= 240) {
        barge.offset ??= offset;
        const clipOffset = offset - barge.offset;
        if (clipOffset < bargeAudio.audio.length) frame = bargeAudio.audio.subarray(clipOffset, clipOffset + 640);
        if (clipOffset / 32 === bargeAudio.leadingSilenceMs) barge.started = performance.now();
        if (clipOffset + 640 === bargeAudio.audio.length) barge.inputComplete = true;
      }
      socket.send(encodeVoiceUplinkAudioFrame({ connectionEpoch: epoch, utteranceId, audioSeq: ++seq,
        capturedAtMonotonicMs: performance.now(), durationMs: 20, audio: frame }));
      if (offset + 640 === audio.length) { active.end = performance.now(); active.inputComplete = true; }
      if (barge && !barge.cancelled && active.heardResponseId && active.audio !== undefined && offset % 3200 === 0) {
        const played = Math.min((playedBytes.get(active.heardResponseId) ?? 0) / 48, performance.now() - active.audio);
        send('response.audio.played', { responseId: active.heardResponseId, playedDurationMs: Math.floor(played) });
      }
      const complete = barge
        ? barge.inputComplete && barge.cancelled && (bargeFollowUp ? barge.done : barge.final)
        : active.done;
      if (complete && quietUntil === Infinity) quietUntil = performance.now() + (verifyTurns ? 2300 : 0);
    }
    if (failure) throw failure;
    if (active.final === undefined || active.committed === undefined || active.started === undefined) {
      throw new Error('Reply completed without a confirmed input turn');
    }
    if (verifyTurns && session?.route.engine === 'agent' &&
      (active.commits !== (bargeFollowUp ? 2 : 1) || active.delegated !== active.commits)) {
      throw new Error('Unexpected number of committed turns or Agent tasks');
    }
    if (barge && (barge.started === undefined || barge.cancelled === undefined || barge.final === undefined ||
      !matchesTranscript(barge.transcripts, expectedBargeTranscript))) throw new Error('Unconfirmed microphone interruption');
    const sample = { round: round + 1, speechEndToAudioMs: Math.round(active.audio! - active.end),
      speechStartToDetectedMs: Math.round(active.started - started - leadingSilenceMs),
      speechEndToTextMs: Math.round(active.text! - active.end),
      speechEndToAsrStopMs: Math.round(active.stopped! - active.end),
      speechEndToFinalMs: Math.round(active.final - active.end),
      finalToCommitMs: Math.round(active.committed - active.final),
      commitToTextMs: Math.round(active.text! - active.committed),
      asrStopToResponseMs: Math.round(active.created! - active.stopped!),
      responseToTextMs: Math.round(active.text! - active.created!), finalTranscripts: active.transcripts.length,
      textToAudioMs: Math.round(active.audio! - active.text!), audioBytes: active.bytes,
      commits: active.commits, agentTasks: active.delegated,
      ...(barge ? { bargeToCancelMs: Math.round(barge.cancelled! - barge.started!),
        bargeToFinalMs: Math.round(barge.final! - barge.started!), bargeReplyBytes: barge.bytes } : {}),
      ...(active.submitted ? { speechEndToTaskSubmittedMs: Math.round(active.submitted - active.end) } : {}),
      ...(active.taskDone ? { speechEndToTaskDoneMs: Math.round(active.taskDone - active.end) } : {}) };
    if (Object.values(sample).some(value => !Number.isFinite(value))) throw new Error('Incomplete timing sample');
    samples.push(sample);
    console.log(JSON.stringify(sample));
    active = undefined;
    await delay(400);
  }
  if (verifyTurns && !existingConversation && mode === 'assistant') {
    const result = await request(`/api/sessions/${conversationId}?include=transcriptRows`);
    const rows = result.session?.transcriptRows as Array<{ role?: string; metadata?: {
      voiceConversation?: boolean; clientMessageId?: string;
    } }> | undefined;
    const voiceInputs = rows?.filter(row => row.role === 'user' && row.metadata?.voiceConversation === true);
    const expected = rounds * (bargeFollowUp ? 2 : 1);
    if (!voiceInputs || voiceInputs.length !== expected || voiceInputs.some(row => !row.metadata?.clientMessageId) ||
      new Set(voiceInputs.map(row => row.metadata?.clientMessageId)).size !== expected) {
      throw new Error(`Expected ${expected} unique persisted voice inputs, found ${voiceInputs?.length ?? 'none'}`);
    }
    console.log(JSON.stringify({ stage: 'transcript_verified', voiceInputs: voiceInputs.length }));
  }
  if (samples.length > 0) {
    const values = samples.map(sample => sample.speechEndToAudioMs).sort((a, b) => a - b);
    const percentile = (sorted: number[], p: number) => sorted[Math.ceil(sorted.length * p) - 1];
    const stages = Object.fromEntries(['speechStartToDetectedMs', 'speechEndToFinalMs', 'speechEndToTextMs', 'finalToCommitMs', 'commitToTextMs', 'textToAudioMs'].map((stage) => {
      const sorted = samples.map(sample => sample[stage]!).sort((a, b) => a - b);
      return [stage, { p50: percentile(sorted, 0.5), p75: percentile(sorted, 0.75), p95: percentile(sorted, 0.95) }];
    }));
    console.log(JSON.stringify({ measurement: 'Last voiced PCM frame sent to first audio received; excludes physical playback.',
      rounds: samples.length, p50Ms: percentile(values, 0.5), p75Ms: percentile(values, 0.75), p95Ms: percentile(values, 0.95), maxMs: values.at(-1), stages,
      targetMs: 1500, withinTarget: values.filter(value => value <= 1500).length }));
  }
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
