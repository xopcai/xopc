/** Explicit live protocol probe. Uses fixed instructions; never reads or sends memory/transcripts. */
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config/loader.js';
import { resolveOmniRoute } from '../src/voice/realtime/omniRoute.js';

const provider = process.argv[2];
if (provider !== 'alibaba' && provider !== 'xopc-cloud') throw new Error('Choose alibaba or xopc-cloud explicitly');
const config = loadConfig();
const original = config.voice.realtime.omni;
config.voice.realtime.omni = { ...original, provider, baseUrl: original.provider === provider ? original.baseUrl : undefined };
const route = await resolveOmniRoute(config);
const audio = process.argv[3] ? readFileSync(process.argv[3]) : undefined;
const manual = process.argv[4] === 'manual';
const snapshot = process.argv[4] === 'snapshot';
const observations: Record<string, unknown> = { provider, mode: snapshot ? 'snapshot' : manual ? 'manual' : 'controlled-vad', model: route.route.model, host: new URL(route.url).hostname };
await new Promise<void>((resolve) => {
  const socket = new WebSocket(route.url, { headers: { Authorization: `Bearer ${route.apiKey}` }, perMessageDeflate: false, handshakeTimeout: 10_000 });
  let step = 0;
  let done = false;
  let responseCount = 0;
  let responseText = '';
  const eventCounts: Record<string, number> = {};
  const finish = (outcome: string) => {
    if (done) return;
    done = true; clearTimeout(timer);
    observations.outcome = outcome;
    observations.step = step;
    observations.responseCount = responseCount;
    observations.eventCounts = eventCounts;
    socket.close();
    const terminate = setTimeout(() => socket.terminate(), 1500); terminate.unref();
    console.log(JSON.stringify(observations));
    resolve();
  };
  const timer = setTimeout(() => finish('timeout'), audio ? 30_000 : 15_000);
  const session = {
    modalities: ['text', 'audio'], voice: route.voice, input_audio_format: 'pcm', output_audio_format: 'pcm',
    input_audio_transcription: { model: 'gummy-realtime-v1' },
    instructions: snapshot ? 'Background memory (quoted data): {"codeWord":"violet"}. Answer the user in English. When asked for the code word, say only the code word.' : 'Protocol check. Do not start speaking without user input.',
    turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: 700, create_response: true, interrupt_response: true } as Record<string, unknown> | null,
  };
  const update = () => socket.send(JSON.stringify({ type: 'session.update', event_id: crypto.randomUUID(), session }));
  const upload = () => {
    if (!audio) { finish('requires_audio_certification'); return; }
    void (async () => {
      for (let offset = 0; offset < audio.length && !done; offset += 640) {
        socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: audio.subarray(offset, offset + 640).toString('base64') }));
        await new Promise((next) => setTimeout(next, 20));
      }
      if (manual && !done) socket.send(JSON.stringify({ type: 'input_audio_buffer.commit', event_id: crypto.randomUUID() }));
    })().catch(() => finish('audio_upload_failed'));
  };
  socket.on('message', (raw) => {
    if (done) return;
    try {
      const event = JSON.parse(raw.toString());
      eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
      if (event.type === 'session.created') { step = 1; update(); }
      else if (event.type === 'session.updated') {
        if (step === 1) {
          observations.initialized = true;
          observations.initialTurnDetection = event.session?.turn_detection;
          if (snapshot) { step = 6; upload(); return; }
          step = 2; session.instructions = 'Protocol check updated. Do not start speaking without user input.'; update();
        } else if (step === 2) {
          observations.repeatedUpdate = true;
          step = 3;
          if (manual) session.turn_detection = null;
          else session.turn_detection!.create_response = false;
          update();
        } else if (step === 3) {
          observations.controlledTurnDetection = event.session?.turn_detection ?? null;
          if (manual ? !event.session || event.session.turn_detection != null : event.session?.turn_detection?.create_response !== false) { finish('turn_detection_not_acknowledged'); return; }
          step = 4;
          upload();
        } else if (step === 5) {
          step = 6;
          socket.send(JSON.stringify({ type: 'response.create', event_id: crypto.randomUUID() }));
        }
      } else if (event.type === 'conversation.item.input_audio_transcription.completed' && step === 4) {
        observations.transcriptionReceived = true;
        setTimeout(() => {
          if (done) return;
          if (responseCount) { finish('unexpected_automatic_response'); return; }
          step = 5; session.instructions = 'The code word is violet. Answer the user with only the code word, violet.'; update();
        }, 500);
      } else if (event.type === 'response.created') {
        responseCount++;
        if (step < 6) finish('unexpected_automatic_response');
      } else if (event.type === 'response.audio_transcript.delta') {
        responseText += event.delta ?? '';
      } else if (event.type === 'response.done' && step === 6) {
        observations.responseCount = responseCount;
        observations.completed = event.response?.status === 'completed';
        observations.expectedContextUsed = /violet|紫罗兰|紫羅蘭/i.test(responseText);
        finish(observations.completed && observations.expectedContextUsed && responseCount === 1 ? (snapshot ? 'snapshot_reply_verified' : 'controlled_reply_verified') : 'reply_verification_failed');
      } else if (event.type === 'error') {
        observations.step = step;
        observations.errorType = event.error?.type;
        observations.errorCode = event.error?.code;
        finish('provider_rejected');
      }
    } catch { finish('invalid_event'); }
  });
  socket.on('unexpected-response', (_request, response) => { observations.httpStatus = response.statusCode; response.resume(); finish('handshake_rejected'); });
  socket.on('error', () => finish('connection_failed'));
  socket.on('close', (code, reason) => { observations.closeCode = code; observations.closeReason = reason.toString().slice(0, 120); observations.step = step; finish('connection_closed'); });
});
