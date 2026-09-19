/** Live output probe with synthetic PCM; logs event metadata, never credentials or audio. */
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { loadConfig } from '../src/config/loader.js';
import { resolveOmniRoute } from '../src/voice/realtime/omniRoute.js';
import { createOmniVoiceEngine } from '../src/voice/realtime/omniEngine.js';

const config = loadConfig();
if (process.argv.includes('stepfun')) config.voice.realtime.omni = { ...config.voice.realtime.omni, model: 'stepaudio-3-realtime-preview', voice: 'cixingnansheng' };
if (process.argv.includes('direct')) config.voice.realtime.omni = { ...config.voice.realtime.omni, provider: 'alibaba', baseUrl: undefined };
const route = await resolveOmniRoute(config);
console.log(JSON.stringify({ host: new URL(route.url).hostname, model: route.route.model }));
route.instructions = 'Reply briefly to the user.';
const audio = readFileSync(process.argv[2]!);
const originalEmit = WebSocket.prototype.emit;
WebSocket.prototype.emit = function (name: string | symbol, ...args: unknown[]) {
  if (name === 'message') {
    const e = JSON.parse(String(args[0]));
    if (e.type === 'error') console.log(JSON.stringify({ providerError: e.error }));
    if (!e.type?.endsWith('.delta')) console.log(JSON.stringify({ upstream: e.type, itemId: e.item_id, responseId: e.response?.id ?? e.response_id, status: e.response?.status, session: e.type === 'session.updated' ? e.session : undefined }));
  }
  return originalEmit.call(this, name, ...args);
};
let bytes = 0;
let completed = false;
let closed = false;
const engine = createOmniVoiceEngine({
  callId: 'live-output-probe', route, silenceDurationMs: 1200, bargeIn: process.argv[3] === 'interrupt',
  send(type, data) { console.log(JSON.stringify({ downstream: type, ...data })); if (type === 'response.done') completed = true; },
  sendAudio(id, chunk) { bytes += chunk.length; engine.acknowledge(id, bytes / 48); },
  async record(entry) { console.log(JSON.stringify({ recorded: entry.role, characters: entry.text.length })); },
  async onClose() { closed = true; await engine.close(); },
});
try {
  await engine.start();
  for (let offset = 0; offset < audio.length && !closed; offset += 640) {
    engine.appendAudio(audio.subarray(offset, offset + 640));
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const deadline = Date.now() + (process.argv.includes('long') ? 75000 : 15000);
  while (!completed && !closed && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  console.log(JSON.stringify({ completed, outputBytes: bytes }));
  if (!completed || !bytes) process.exitCode = 1;
} finally { await engine.close(); WebSocket.prototype.emit = originalEmit; }
