/** Real STT → Agent → TTS over the Gateway v3 protocol, using a disposable conversation. */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import WebSocket from 'ws';
import { decodeVoiceAudioFrame, encodeVoiceUplinkAudioFrame } from '@xopcai/realtime-protocol/voice';

const audio = readFileSync(process.argv[2]!);
const agentId = process.argv[3] ?? 'main';
const rounds = Number(process.argv[4] ?? 2);
if (!audio.length || audio.length % 640 || !Number.isInteger(rounds) || rounds < 1 || rounds > 10) {
  throw new Error('Usage: probe-gateway-voice-e2e.ts PCM16_16KHZ_FILE [AGENT_ID] [ROUNDS]');
}
const config = JSON.parse(readFileSync(process.env.XOPC_CONFIG_PATH ?? process.env.XOPC_CONFIG
  ?? join(homedir(), '.xopc', 'xopc.json'), 'utf8'));
const base = `http://127.0.0.1:${config.gateway.port}`;
const headers = { Authorization: `Bearer ${config.gateway.auth.token}`, 'Content-Type': 'application/json' };
async function request(path: string, method = 'GET', body?: object) {
  const response = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(JSON.stringify({ path, status: response.status, error: result.error }));
  return result.payload ?? result;
}
const agents = await request('/api/agents');
const model = agents.agents.find((entry: { id: string }) => entry.id === agentId)?.effective?.models?.chat?.primary;
if (!model) throw new Error('Agent model unavailable');
const conversationId = crypto.randomUUID();
let socket: WebSocket | undefined;
let session: { sessionId: string; ticket: string; websocketPath: string } | undefined;
let epoch = 0;
let failure: Error | undefined;
let transcripts = 0;
const responses = new Map<string, { bytes: number; text: string; nonzero: boolean; done: boolean }>();
const send = (type: string, payload: object) => socket!.send(JSON.stringify({ protocolVersion: 3, messageId: crypto.randomUUID(), sentAt: Date.now(), type, payload }));
const completed = () => [...responses.values()].filter(response => response.done).length;
const waitFor = async (condition: () => boolean, milliseconds: number) => {
  const deadline = Date.now() + milliseconds;
  while (!condition() && !failure && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  if (failure) throw failure;
  if (!condition()) throw new Error('Voice E2E stage timed out');
};
try {
  const body = { commandId: crypto.randomUUID(), purpose: 'voice',
    creation: { agentId, projectId: null, execution: null, temporary: true, model, thinkingLevel: 'off' } };
  let ready = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await request(`/api/sessions/${conversationId}/materialize`, 'POST', body);
    if (result.receipt?.lifecycle === 'ready') { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('Diagnostic conversation did not become ready');
  session = await request('/api/voice/realtime/sessions', 'POST', {
    purpose: 'conversation', mode: 'assistant', conversationId, language: 'zh', supportedProtocolVersions: [3], mediaPreferences: ['websocket-pcm'],
  });
  socket = new WebSocket(base.replace('http:', 'ws:') + session!.websocketPath);
  socket.on('error', error => { failure = error; });
  socket.on('message', (data, binary) => {
    if (binary) {
      const frame = decodeVoiceAudioFrame(data as Buffer);
      const response = responses.get(frame.responseId);
      if (!response) { failure = new Error('Audio arrived without response.created'); return; }
      response.bytes += frame.audio.length;
      response.nonzero ||= frame.audio.some(byte => byte !== 0);
      send('response.audio.played', { responseId: frame.responseId, playedDurationMs: Math.floor(response.bytes / 48) });
      return;
    }
    const event = JSON.parse(data.toString());
    if (event.type === 'session.ready') epoch = event.payload.connectionEpoch;
    if (event.type === 'session.error') failure = new Error(`Voice session failed: ${event.payload.code}: ${event.payload.message}`);
    if (event.type === 'input.transcript.final') {
      transcripts += 1;
      console.log(JSON.stringify({ stage: 'transcript', text: event.payload.text }));
    }
    if (event.type === 'response.created') responses.set(event.payload.responseId, { bytes: 0, text: '', nonzero: false, done: false });
    const response = responses.get(event.payload.responseId);
    if (event.type === 'response.text.delta' && response) response.text += event.payload.delta;
    if (event.type === 'response.done' && response) {
      if (!event.payload.audio || !response.bytes || !response.nonzero || !response.text.trim()) failure = new Error('Reply has no text or audible PCM');
      response.done = true;
      console.log(JSON.stringify({ stage: 'response', text: response.text, audioBytes: response.bytes, finishReason: event.payload.finishReason }));
    }
  });
  await once(socket, 'open');
  send('session.start', { sessionId: session!.sessionId, ticket: session!.ticket });
  await waitFor(() => epoch !== 0, 40_000);
  for (let round = 0; round < rounds; round++) {
    let seq = 0;
    const before = completed();
    const utteranceId = crypto.randomUUID();
    for (let offset = 0; offset < audio.length; offset += 640) {
      if (failure) throw failure;
      socket.send(encodeVoiceUplinkAudioFrame({ connectionEpoch: epoch, utteranceId, audioSeq: ++seq,
        capturedAtMonotonicMs: performance.now(), durationMs: 20, audio: audio.subarray(offset, offset + 640) }));
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await waitFor(() => completed() > before, 90_000);
    if (transcripts < round + 1) throw new Error('Reply completed without an input transcript');
  }
  console.log(JSON.stringify({ passed: true, mode: 'assistant', agentId, rounds, transcripts, responses: completed(),
    audioBytes: [...responses.values()].reduce((total, response) => total + response.bytes, 0) }));
} finally {
  if (socket?.readyState === WebSocket.OPEN) send('session.stop', { reason: 'user_finished' });
  socket?.terminate();
  if (session) await request('/api/voice/realtime/sessions/cancel', 'POST', { sessionId: session.sessionId, ticket: session.ticket }).catch(() => undefined);
  await request(`/api/sessions/${conversationId}`, 'DELETE').catch(error => console.error('Diagnostic conversation cleanup failed:', error.message));
}
