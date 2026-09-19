/** Explicit live gateway probe: creates a diagnostic conversation and simulates playback ACKs. */
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import WebSocket from 'ws';
import { decodeVoiceAudioFrame, encodeVoiceUplinkAudioFrame } from '@xopcai/realtime-protocol/voice';
import { loadConfig } from '../src/config/loader.js';

const config = loadConfig();
const base = `http://127.0.0.1:${config.gateway.port}`;
const headers = { Authorization: `Bearer ${config.gateway.auth.token}`, 'Content-Type': 'application/json' };
async function post(path: string, body: object) {
  const response = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(JSON.stringify({ status: response.status, error: result.error }));
  return result.payload ?? result;
}
const conversation = await post('/api/sessions', { temporary: true });
console.log(JSON.stringify({ diagnosticConversation: conversation }));
const conversationId = conversation.conversationId ?? conversation.session?.conversationId;
const session = await post('/api/voice/realtime/sessions', { purpose: 'conversation', mode: 'natural', conversationId, supportedProtocolVersions: [3], mediaPreferences: ['websocket-pcm'] });
const socket = new WebSocket(base.replace('http:', 'ws:') + session.websocketPath);
let epoch = 0, bytes = 0, completed = false, failed = false;
const send = (type: string, payload: object) => socket.send(JSON.stringify({ protocolVersion: 3, messageId: crypto.randomUUID(), sentAt: Date.now(), type, payload }));
socket.on('message', (data, binary) => {
  if (binary) {
    const frame = decodeVoiceAudioFrame(data as Buffer);
    bytes += frame.audio.length;
    send('response.audio.played', { responseId: frame.responseId, playedDurationMs: Math.floor(bytes / 48) });
    return;
  }
  const event = JSON.parse(data.toString());
  console.log(JSON.stringify({ type: event.type, payload: event.payload }));
  if (event.type === 'session.ready') epoch = event.payload.connectionEpoch;
  if (event.type === 'response.done') completed = true;
  if (event.type === 'session.error') failed = true;
});
try {
  await once(socket, 'open');
  send('session.start', { sessionId: session.sessionId, ticket: session.ticket });
  const deadline = Date.now() + 40000;
  while (!epoch && !failed && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  if (!epoch) throw new Error('Gateway voice not ready');
  const audio = readFileSync(process.argv[2]!);
  for (let offset = 0; offset + 640 <= audio.length && !failed; offset += 640) {
    socket.send(encodeVoiceUplinkAudioFrame({ connectionEpoch: epoch, utteranceId: 'probe', audioSeq: offset / 640 + 1, capturedAtMonotonicMs: offset / 32, durationMs: 20, audio: audio.subarray(offset, offset + 640) }));
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  while (!completed && !failed && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  console.log(JSON.stringify({ completed, audioBytes: bytes, conversationId }));
  if (!completed || !bytes) process.exitCode = 1;
} finally {
  if (socket.readyState === WebSocket.OPEN) send('session.stop', { reason: 'user_finished' });
  socket.close();
}
