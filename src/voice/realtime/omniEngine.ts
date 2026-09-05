import crypto from 'node:crypto';
import WebSocket from 'ws';

import { createLogger } from '../../utils/logger.js';
import { AudioPlaybackWindow } from './audio-playback-window.js';
import type { VoiceEngine, VoiceEventSink } from './engine.js';
import type { OmniRoute } from './omniRoute.js';

const log = createLogger('Voice:Omni');
// Generation can outrun playback. Keep one minute of PCM, while the client window stays two seconds.
const MAX_QUEUED_AUDIO_BYTES = 24_000 * 2 * 60;
// About two seconds of 16 kHz PCM, including one maximum-size client frame.
const MAX_PENDING_INPUT_BYTES = 64 * 1024;
const UPLOAD_TIMEOUT_MS = 10_000;
const FAILURE_MESSAGES: Record<string, string> = {
  OMNI_UPLOAD_TIMEOUT: 'The connection to the voice service stopped uploading audio. Check the network to your configured endpoint and reconnect.',
  OMNI_INPUT_RESET_TIMEOUT: 'The voice service did not acknowledge clearing microphone input. Reconnect to continue.',
  OMNI_START_TIMEOUT: 'The voice service did not become ready in time.',
  OMNI_CONNECTION_FAILED: 'Could not connect to the voice service. Check network and service availability.',
  OMNI_CONNECTION_REJECTED: 'The voice service rejected the connection. Check account access, quota and route configuration.',
  OMNI_CONNECTION_CLOSED: 'The voice service closed the connection.',
  OMNI_PROVIDER_ERROR: 'The voice service reported an error.',
  OMNI_RESPONSE_FAILED: 'The voice service could not complete its reply.',
  OMNI_INVALID_TRANSCRIPT: 'The voice service returned an invalid transcript.',
  OMNI_INVALID_AUDIO: 'The voice service returned invalid audio.',
  OMNI_TRANSCRIPT_LIMIT: 'The voice reply exceeded the transcript limit.',
  OMNI_PROTOCOL_ERROR: 'The voice service returned an unexpected message.',
  OMNI_ITEM_LIMIT: 'This call reached its conversation limit.',
  TRANSCRIPT_WRITE_FAILED: 'The conversation could not be saved. Check gateway storage.',
};

export interface OmniTranscript {
  itemId: string;
  role: 'user' | 'assistant';
  text: string;
  interrupted: boolean;
}

interface ResponseState {
  id: string;
  text: string;
  audio: boolean;
  generating: boolean;
  queuedBytes: number;
  abort: AbortController;
  playback: AudioPlaybackWindow;
  tail: Promise<void>;
}

export function createOmniVoiceEngine(options: {
  callId: string;
  route: OmniRoute;
  silenceDurationMs: number;
  bargeIn: boolean;
  send: VoiceEventSink;
  sendAudio: (responseId: string, bytes: Uint8Array) => void;
  record: (entry: OmniTranscript) => Promise<void>;
  onClose: (reason: string, notify: boolean) => Promise<void>;
}): VoiceEngine {
  let socket: WebSocket | undefined;
  let closed = false;
  let ready = false;
  let muted = false;
  let inputBlocked = false;
  let clearingInput = false;
  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  const discardedInputs = new Set<string>();
  const pendingInputs = new Set<string>();
  let failed = false;
  let platformRequestId: string | undefined;
  let active: ResponseState | undefined;
  let rejectStart: ((error: Error) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const recorded = new Set<string>();
  let writes = Promise.resolve();
  let cancellationPending = false;
  let inputQueue: Buffer[] = [];
  let queuedInputBytes = 0;
  let uploadingBytes = 0;
  let uploadTimer: ReturnType<typeof setTimeout> | undefined;
  const send = (type: string, fields: Record<string, unknown> = {}) => {
    if (closed || socket?.readyState !== WebSocket.OPEN) throw new Error('Omni connection is closed');
    socket.send(JSON.stringify({ type, event_id: crypto.randomUUID(), ...fields }));
  };
  function pumpInput() {
    if (closed || failed || uploadingBytes || muted || clearingInput) return;
    const bytes = inputQueue.shift();
    if (!bytes) return;
    queuedInputBytes -= bytes.length;
    uploadingBytes = bytes.length;
    uploadTimer = setTimeout(() => fail('OMNI_UPLOAD_TIMEOUT'), UPLOAD_TIMEOUT_MS);
    try {
      if (socket?.readyState !== WebSocket.OPEN) throw new Error('Omni connection is closed');
      // One write at a time keeps unsent audio discardable and leaves room for controls.
      socket.send(JSON.stringify({ type: 'input_audio_buffer.append', event_id: crypto.randomUUID(), audio: bytes.toString('base64') }), (error) => {
        clearTimeout(uploadTimer);
        uploadingBytes = 0;
        if (closed || failed) return;
        if (error) { fail('OMNI_CONNECTION_FAILED'); return; }
        pumpInput();
      });
    } catch {
      clearTimeout(uploadTimer);
      fail('OMNI_CONNECTION_FAILED');
    }
  }
  const save = (entry: OmniTranscript) => {
    if (!entry.text.trim() || recorded.has(entry.itemId)) return;
    if (recorded.size >= 10_000) { fail('OMNI_ITEM_LIMIT'); return; }
    recorded.add(entry.itemId);
    writes = writes.then(() => options.record(entry)).catch((err) => {
      log.warn({ err, sessionId: options.callId }, 'Native voice transcript write failed');
      fail('TRANSCRIPT_WRITE_FAILED');
    });
  };
  const cancel = (reason: 'barge_in' | 'client_cancelled' | 'session_closed') => {
    const response = active;
    if (!response) return false;
    active = undefined;
    response.abort.abort(reason);
    save({ itemId: response.id, role: 'assistant', text: response.text, interrupted: true });
    options.send('response.cancelled', { responseId: response.id, reason });
    // VAD may already have cancelled generation; do not send duplicate cancellations.
    if (reason === 'client_cancelled' && response.generating && socket?.readyState === WebSocket.OPEN) {
      cancellationPending = true;
      send('response.cancel');
    }
    return true;
  };
  const finish = async (response: ResponseState) => {
    await response.tail;
    if (active !== response || closed) return;
    await response.playback.drain(response.abort.signal);
    if (active !== response || closed) return;
    save({ itemId: response.id, role: 'assistant', text: response.text, interrupted: false });
    options.send('response.audio.done', { responseId: response.id });
    options.send('response.done', { responseId: response.id, audio: response.audio, finishReason: response.audio ? 'completed' : 'text_only' });
    active = undefined;
  };
  const stopReply = (response: ResponseState, code: string) => {
    if (closed || active !== response) return;
    log.warn({ sessionId: options.callId, platformRequestId, responseId: response.id, code, queuedBytes: response.queuedBytes }, 'Native voice reply stopped; call remains connected');
    cancel('client_cancelled');
    options.send('session.error', { code: 'RESPONSE_FAILED', message: 'Voice playback could not keep up. This reply was stopped; you can continue speaking.', recoverable: true });
  };
  function fail(code: string, details: { closeCode?: number; upstreamStatus?: number } = {}) {
    if (closed || failed) return;
    failed = true;
    log.warn({ sessionId: options.callId, platformRequestId, responseId: active?.id, code,
      provider: options.route.route.provider, upstreamHost: new URL(options.route.url).hostname,
      queuedInputBytes, uploadingBytes, bufferedAmount: socket?.bufferedAmount, ...details }, `Native voice conversation failed: ${code}`);
    rejectStart?.(new Error(code));
    const reference = platformRequestId ?? options.callId;
    options.send('session.error', { code, message: `${FAILURE_MESSAGES[code] ?? 'Natural conversation failed.'} (${code}; reference: ${reference})`, recoverable: false });
    void options.onClose('omni_error', true);
  }
  function discardInput() {
    inputQueue = [];
    queuedInputBytes = 0;
    inputBlocked = true;
    if (clearingInput) return;
    clearingInput = true;
    // Clearing follows the in-flight write, so allow the upload deadline to fire first.
    clearTimer = setTimeout(() => fail('OMNI_INPUT_RESET_TIMEOUT'), uploadingBytes ? UPLOAD_TIMEOUT_MS + 5_000 : 5_000);
    for (const id of pendingInputs) discardedInputs.add(id);
    pendingInputs.clear();
    if (discardedInputs.size > 10_000) { fail('OMNI_ITEM_LIMIT'); return; }
    send('input_audio_buffer.clear');
  }
  const engine: VoiceEngine = {
    start() {
      return new Promise<void>((resolve, reject) => {
        rejectStart = reject;
        socket = new WebSocket(options.route.url, { headers: { Authorization: `Bearer ${options.route.apiKey}` }, maxPayload: 1024 * 1024, perMessageDeflate: false, handshakeTimeout: 15_000 });
        socket.on('upgrade', (response) => {
          const id = response.headers['x-xopc-request-id'];
          if (typeof id === 'string' && /^[a-zA-Z0-9-]{1,160}$/.test(id)) platformRequestId = id;
          log.info({ sessionId: options.callId, platformRequestId, model: options.route.route.model, provider: options.route.route.provider }, 'Native voice upstream connected');
        });
        timer = setTimeout(() => { fail('OMNI_START_TIMEOUT'); engine.close(); }, 15_000);
        socket.on('error', () => fail('OMNI_CONNECTION_FAILED'));
        socket.on('close', (closeCode) => { if (!closed) fail('OMNI_CONNECTION_CLOSED', { closeCode }); });
        socket.on('unexpected-response', (_request, response) => {
          response.resume();
          fail('OMNI_CONNECTION_REJECTED', { upstreamStatus: response.statusCode });
        });
        socket.on('message', (raw, binary) => {
          if (closed) return;
          try {
            if (binary) throw new Error('Unexpected Omni binary frame');
            const event = JSON.parse(raw.toString());
            if (event.type === 'error') {
              // Qwen may finish generation before a local cancellation reaches it.
              if (cancellationPending && event.error?.type === 'invalid_request_error' && event.error?.message === 'Conversation has none active response') { cancellationPending = false; return; }
              fail('OMNI_PROVIDER_ERROR'); return;
            }
            if (event.type === 'session.created') {
              send('session.update', { session: {
                modalities: ['text', 'audio'], voice: options.route.voice,
                instructions: options.route.instructions, input_audio_format: 'pcm', output_audio_format: 'pcm',
                input_audio_transcription: { model: 'gummy-realtime-v1' },
                turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: options.silenceDurationMs, create_response: true, interrupt_response: options.bargeIn },
              } });
            } else if (event.type === 'session.updated' && !ready) {
              ready = true; clearTimeout(timer); rejectStart = undefined; resolve();
            } else if (event.type === 'input_audio_buffer.cleared') {
              clearingInput = false;
              clearTimeout(clearTimer);
            } else if (event.type === 'input_audio_buffer.speech_started') {
              if (muted || clearingInput) { discardedInputs.add(String(event.item_id)); return; }
              inputBlocked = false;
              pendingInputs.add(String(event.item_id));
              if (options.bargeIn) cancel('barge_in');
              options.send('input.speech_started', { utteranceId: String(event.item_id) });
            } else if (event.type === 'input_audio_buffer.speech_stopped') {
              if (muted || inputBlocked || discardedInputs.has(String(event.item_id))) return;
              options.send('input.speech_stopped', { utteranceId: String(event.item_id) });
            } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
              if (typeof event.transcript !== 'string' || event.transcript.length > 32_000 || typeof event.item_id !== 'string') { fail('OMNI_INVALID_TRANSCRIPT'); return; }
              if (muted || inputBlocked || discardedInputs.has(event.item_id) || recorded.has(event.item_id)) return;
              pendingInputs.delete(event.item_id);
              save({ itemId: event.item_id, role: 'user', text: event.transcript, interrupted: false });
              options.send('input.transcript.final', { utteranceId: event.item_id, revision: 1, text: event.transcript });
            } else if (event.type === 'response.created') {
              if (muted || inputBlocked) {
                cancellationPending = true;
                send('response.cancel');
                return;
              }
              cancellationPending = false;
              if (active) cancel('barge_in');
              const id = event.response?.id;
              if (typeof id !== 'string' || !id.length || id.length > 160) throw new Error('Invalid response ID');
              active = { id, text: '', audio: false, generating: true, queuedBytes: 0, abort: new AbortController(), playback: new AudioPlaybackWindow(), tail: Promise.resolve() };
              options.send('response.created', { responseId: id });
            } else if (active && event.response_id === active.id && event.type === 'response.audio_transcript.delta') {
              if (typeof event.delta !== 'string' || active.text.length + event.delta.length > 32_000) { fail('OMNI_TRANSCRIPT_LIMIT'); return; }
              active.text += event.delta;
              options.send('response.text.delta', { responseId: active.id, delta: event.delta });
            } else if (active && event.response_id === active.id && event.type === 'response.audio.delta') {
              if (typeof event.delta !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(event.delta)) { fail('OMNI_INVALID_AUDIO'); return; }
              const audio = Buffer.from(event.delta, 'base64');
              if (!audio.length || audio.length % 2) { fail('OMNI_INVALID_AUDIO'); return; }
              const response = active;
              if (response.queuedBytes + audio.length > MAX_QUEUED_AUDIO_BYTES) { stopReply(response, 'OMNI_OUTPUT_BACKPRESSURE'); return; }
              response.queuedBytes += audio.length;
              response.tail = response.tail.then(async () => {
                for (let offset = 0; offset < audio.length; offset += 24_000) {
                  if (closed || active !== response) return;
                  const chunk = audio.subarray(offset, offset + 24_000);
                  await response.playback.reserve(chunk.length, response.abort.signal);
                  if (closed || active !== response) return;
                  if (!response.audio) { response.audio = true; options.send('response.audio.started', { responseId: response.id, format: { encoding: 'pcm_s16le', channels: 1, sampleRate: 24_000 } }); }
                  options.sendAudio(response.id, chunk);
                }
              }).catch(() => { if (!response.abort.signal.aborted) stopReply(response, 'OMNI_PLAYBACK_FAILED'); }).finally(() => { response.queuedBytes -= audio.length; });
            } else if (event.type === 'response.done' && active?.id === event.response?.id) {
              active.generating = false;
              if (event.response.status === 'cancelled') cancel('barge_in');
              else if (event.response.status !== 'completed') fail('OMNI_RESPONSE_FAILED');
              else {
                const response = active;
                options.send('response.text.done', { responseId: response.id });
                void finish(response).catch(() => { if (!response.abort.signal.aborted) stopReply(response, 'OMNI_PLAYBACK_FAILED'); });
              }
            }
          } catch { fail('OMNI_PROTOCOL_ERROR'); }
        });
      });
    },
    setInputMuted(next) {
      muted = next;
      if (next) discardInput();
    },
    appendAudio(bytes) {
      if (closed || failed || muted || clearingInput) return;
      if (!ready || !bytes.length || bytes.length % 2 || bytes.length > 64 * 1024) throw new Error('Invalid Omni input');
      if (queuedInputBytes + uploadingBytes + bytes.length > MAX_PENDING_INPUT_BYTES) {
        log.warn({ sessionId: options.callId, provider: options.route.route.provider,
          upstreamHost: new URL(options.route.url).hostname, queuedInputBytes, uploadingBytes,
          bufferedAmount: socket?.bufferedAmount }, 'Native voice input discarded after upload congestion; call remains connected');
        discardInput();
        options.send('session.error', { code: 'INPUT_DROPPED', message: 'The voice connection is slow. This microphone input was discarded; please repeat it once the connection recovers.', recoverable: true });
        return;
      }
      for (let offset = 0; offset < bytes.length; offset += 24_000) {
        const chunk = Buffer.from(bytes.subarray(offset, offset + 24_000));
        inputQueue.push(chunk);
        queuedInputBytes += chunk.length;
      }
      pumpInput();
    },
    async commit() { throw new Error('Natural conversation uses automatic turn detection'); },
    cancel(responseId, reason) {
      if (active?.id !== responseId) return false;
      if (reason === 'client_cancelled') discardInput();
      return cancel(reason);
    },
    acknowledge(responseId, playedBytes) { if (active?.id === responseId) active.playback.acknowledge(playedBytes); },
    close() {
      if (closed) return writes;
      closed = true; cancel('session_closed'); clearTimeout(timer); clearTimeout(clearTimer); clearTimeout(uploadTimer);
      inputQueue = []; queuedInputBytes = 0;
      rejectStart?.(new Error('Omni connection closed')); rejectStart = undefined;
      socket?.terminate();
      return writes;
    },
  };
  return engine;
}
