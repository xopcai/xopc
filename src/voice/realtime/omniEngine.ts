import { assertProviderUsage } from '../../providers/model-usage.js';
import crypto from 'node:crypto';
import WebSocket from 'ws';

import { createLogger } from '../../utils/logger.js';
import { AudioPlaybackWindow } from './audio-playback-window.js';
import { PlaybackEchoCandidates } from './playback-echo.js';
import { hasContinuationHint, TurnCoordinator } from './turnPolicy.js';
import { PcmFrameBuffer } from './pcmFrameBuffer.js';
import type { VoiceEngine, VoiceEventSink } from './engine.js';
import type { OmniRoute } from './omniRoute.js';

const log = createLogger('Voice:Omni');
// Generation can outrun playback. Keep one minute of PCM, while the client window stays two seconds.
const MAX_QUEUED_AUDIO_BYTES = 24_000 * 2 * 60;
// About two seconds of 16 kHz PCM, including one maximum-size client frame.
const MAX_PENDING_INPUT_BYTES = 64 * 1024;
const UPLOAD_TIMEOUT_MS = 10_000;
const RESPONSE_START_TIMEOUT_MS = 30_000;
const CANCELLATION_ERROR_GRACE_MS = 5_000;
const PLAYBACK_ECHO_TAIL_MS = 3_000;
const HIGGS_ENDPOINT_MS = 180;
const HIGGS_TRANSCRIPT_TIMEOUT_MS = 900;
const HIGGS_GREETING_GRACE_MS = 1_100;
const HIGGS_CONTINUATION_GRACE_MS = 1_800;
const FAILURE_MESSAGES: Record<string, string> = {
  OMNI_UPLOAD_TIMEOUT: 'The connection to the voice service stopped uploading audio. Check the network to your configured endpoint and reconnect.',
  OMNI_INPUT_RESET_TIMEOUT: 'The voice service did not acknowledge clearing microphone input. Reconnect to continue.',
  OMNI_CONTEXT_FAILED: 'The conversation context could not be restored. Reconnect and try again.',
  OMNI_START_TIMEOUT: 'The voice service did not become ready in time.',
  OMNI_RESPONSE_START_TIMEOUT: 'Your speech was transcribed, but the voice model did not start a reply within 30 seconds. Reconnect or select another realtime voice model.',
  OMNI_CONNECTION_FAILED: 'Could not connect to the voice service. Check network and service availability.',
  OMNI_CONNECTION_REJECTED: 'The voice service rejected the connection. Check account access, quota and route configuration.',
  OMNI_CONNECTION_CLOSED: 'The voice service closed the connection.',
  BOSON_AUTH_FAILED: 'Boson rejected the API key. Update it in voice settings and try again.',
  BOSON_QUOTA_EXCEEDED: 'Boson has no available quota. Check the account balance or usage limit.',
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
  published: boolean;
  release: () => void;
  settled: Promise<void>;
  pcm: PcmFrameBuffer;
  higgsAudio?: { itemId: string; contentIndex: number; playedMs: number };
}

export function createOmniVoiceEngine(options: {
  callId: string;
  route: OmniRoute;
  restoreInstructions?: () => Promise<string>;
  silenceDurationMs: number;
  bargeIn: boolean;
  send: VoiceEventSink;
  sendAudio: (responseId: string, bytes: Uint8Array) => void;
  onUserInput?: () => void;
  record: (entry: OmniTranscript) => Promise<void>;
  onClose: (reason: string, notify: boolean) => Promise<void>;
}): VoiceEngine {
  const higgs = options.route.route.provider === 'boson';
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
  let lastInputAt = 0;
  let active: ResponseState | undefined;
  const echoCandidates = new PlaybackEchoCandidates();
  let recentPlayback: { text: string; expiresAt: number } | undefined;
  let waitingForCancellation: string | undefined;
  let responseCreateQueued = false;
  let rejectStart: ((error: Error) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const recorded = new Set<string>();
  let writes = Promise.resolve();
  let cancellationPendingUntil = 0;
  let inputQueue: Buffer[] = [];
  let queuedInputBytes = 0;
  let uploadingBytes = 0;
  let uploadTimer: ReturnType<typeof setTimeout> | undefined;
  let turnSettled = false;
  let responseStartTimer: ReturnType<typeof setTimeout> | undefined;
  const speaking = new Set<string>();
  let higgsEndpoint: { id: string; stoppedAt?: number; committedAt?: number; text?: string } | undefined;
  let higgsEndpointTimer: ReturnType<typeof setTimeout> | undefined;
  function resetHiggsEndpoint() {
    clearTimeout(higgsEndpointTimer);
    higgsEndpoint = undefined;
  }
  function writeInputTranscript(id: string, text: string) {
    save({ itemId: id, role: 'user', text, interrupted: false });
    options.send('input.transcript.final', { utteranceId: id, revision: 1, text });
  }
  function settleHiggsEndpoint() {
    const endpoint = higgsEndpoint;
    if (!endpoint || endpoint.committedAt === undefined || endpoint.stoppedAt === undefined) return;
    clearTimeout(higgsEndpointTimer);
    // Generation and transcription run in parallel. A late commit must not
    // release its speculative reply before we can check the transcript.
    if (endpoint.text === undefined) {
      higgsEndpointTimer = setTimeout(() => {
        if (closed || failed || higgsEndpoint !== endpoint) return;
        discardInput();
        options.send('session.error', { code: 'INPUT_DROPPED', message: 'Could not confirm this voice turn. Please repeat it.', recoverable: true });
      }, Math.max(0, endpoint.committedAt + HIGGS_TRANSCRIPT_TIMEOUT_MS - Date.now()));
      return;
    }
    let graceMs = 0;
    if (hasContinuationHint(endpoint.text) || /(?:我想问(?:一下)?|等一下|等等|等一等)[\s。！？、，；：,.!?;:]*$/u.test(endpoint.text)) {
      graceMs = HIGGS_CONTINUATION_GRACE_MS;
    } else if (/^(?:你好|您好|嗨|哈喽|喂|hello|hi|hey)[\s。！？、，；：,.!?;:]*$/iu.test(endpoint.text)) {
      graceMs = HIGGS_GREETING_GRACE_MS;
    }
    const release = () => {
      if (closed || failed || higgsEndpoint !== endpoint) return;
      resetHiggsEndpoint();
      if (endpoint.text !== undefined) writeInputTranscript(endpoint.id, endpoint.text);
      turnSettled = true;
      options.send('turn.committed', { turnId: endpoint.id });
      if (active) publish(active);
    };
    const remainingMs = endpoint.stoppedAt + graceMs - Date.now();
    if (remainingMs > 0) higgsEndpointTimer = setTimeout(release, remainingMs);
    else release();
  }
  function maybeCreateResponse() {
    if (!responseCreateQueued || active || waitingForCancellation || closed || failed || muted || inputBlocked) return;
    responseCreateQueued = false;
    clearTimeout(responseStartTimer);
    responseStartTimer = setTimeout(() => fail('OMNI_RESPONSE_START_TIMEOUT'), RESPONSE_START_TIMEOUT_MS);
    // Managed Cloud sessions generate replies after VAD and reject response.create.
    if (!options.route.route.managed) send('response.create');
  }
  const turn = new TurnCoordinator((_text, decision, turnId) => {
    if (closed || failed || muted || inputBlocked) return;
    options.send('turn.decision', { turnId, disposition: decision.disposition, confidence: decision.confidence, source: decision.source, committed: true });
    options.send('turn.committed', { turnId });
    turnSettled = true;
    const preparedReply = Boolean(active && !active.published);
    if (active && !active.published) publish(active);
    responseCreateQueued = !preparedReply;
    maybeCreateResponse();
  });
  function publish(response: ResponseState) {
    if (response.published || active !== response) return;
    response.published = true;
    options.send('response.created', { responseId: response.id });
    if (response.text) options.send('response.text.delta', { responseId: response.id, delta: response.text });
    response.release();
  }
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
  const cancel = (reason: 'barge_in' | 'client_cancelled' | 'session_closed', upstreamStopped = false) => {
    const response = active;
    if (!response) return false;
    if (response.audio && response.text) recentPlayback = { text: response.text, expiresAt: Date.now() + PLAYBACK_ECHO_TAIL_MS };
    active = undefined;
    response.abort.abort(reason);
    response.release();
    if (response.published) {
      save({ itemId: response.id, role: 'assistant', text: response.text, interrupted: true });
      options.send('response.cancelled', { responseId: response.id, reason });
    }
    if (reason !== 'session_closed' && socket?.readyState === WebSocket.OPEN) {
      if (response.generating && !upstreamStopped) {
        waitingForCancellation = response.id;
        cancellationPendingUntil = Date.now() + CANCELLATION_ERROR_GRACE_MS;
        send('response.cancel', higgs ? { response_id: response.id } : {});
      }
      if (response.higgsAudio) {
        const { itemId, contentIndex, playedMs } = response.higgsAudio;
        send('conversation.item.truncate', { item_id: itemId, content_index: contentIndex, audio_end_ms: playedMs });
      }
    }
    return true;
  };
  const finish = async (response: ResponseState) => {
    await response.settled;
    if (active !== response || closed) return;
    options.send('response.text.done', { responseId: response.id });
    await response.tail;
    if (active !== response || closed) return;
    const finalFrame = response.pcm.finish();
    if (finalFrame) {
      await response.playback.reserve(finalFrame.byteLength, response.abort.signal);
      if (active !== response || closed) return;
      if (!response.audio) { response.audio = true; options.send('response.audio.started', { responseId: response.id, format: { encoding: 'pcm_s16le', channels: 1, sampleRate: 24_000 } }); }
      options.sendAudio(response.id, finalFrame);
    }
    await response.playback.drain(response.abort.signal);
    if (active !== response || closed) return;
    save({ itemId: response.id, role: 'assistant', text: response.text, interrupted: false });
    if (response.audio && response.text) recentPlayback = { text: response.text, expiresAt: Date.now() + PLAYBACK_ECHO_TAIL_MS };
    options.send('response.audio.done', { responseId: response.id });
    options.send('response.done', { responseId: response.id, audio: response.audio, finishReason: response.audio ? 'completed' : 'text_only' });
    active = undefined;
    maybeCreateResponse();
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
    clearTimeout(responseStartTimer);
    resetHiggsEndpoint();
    turn.reset();
    echoCandidates.clear();
    responseCreateQueued = false;
    log.warn({ sessionId: options.callId, platformRequestId, responseId: active?.id, code,
      provider: options.route.route.provider, upstreamHost: new URL(options.route.url).hostname,
      queuedInputBytes, uploadingBytes, bufferedAmount: socket?.bufferedAmount, ...details }, `Native voice conversation failed: ${code}`);
    rejectStart?.(new Error(code));
    const reference = platformRequestId ?? options.callId;
    options.send('session.error', { code, message: `${FAILURE_MESSAGES[code] ?? 'Natural conversation failed.'} (${code}; reference: ${reference})`, recoverable: false });
    void options.onClose('omni_error', true);
  }
  function discardInput() {
    clearTimeout(responseStartTimer);
    if (higgsEndpoint?.text !== undefined) writeInputTranscript(higgsEndpoint.id, higgsEndpoint.text);
    resetHiggsEndpoint();
    turn.reset();
    echoCandidates.clear();
    responseCreateQueued = false;
    speaking.clear();
    turnSettled = false;
    if (active && !active.published) cancel('client_cancelled');
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
        assertProviderUsage(options.route.route.provider, options.route.url);
        socket = new WebSocket(options.route.url, { headers: { Authorization: `Bearer ${options.route.apiKey}` }, maxPayload: 1024 * 1024, perMessageDeflate: false, handshakeTimeout: 15_000 });
        socket.on('upgrade', (response) => {
          const id = response.headers['x-xopc-request-id'];
          if (typeof id === 'string' && /^[a-zA-Z0-9-]{1,160}$/.test(id)) platformRequestId = id;
          log.info({ sessionId: options.callId, platformRequestId, model: options.route.route.model, provider: options.route.route.provider }, 'Native voice upstream connected');
        });
        timer = setTimeout(() => { fail('OMNI_START_TIMEOUT'); engine.close(); }, 15_000);
        socket.on('error', () => fail('OMNI_CONNECTION_FAILED'));
        socket.on('close', (closeCode) => {
          if (!closed) fail(higgs && closeCode === 3000 ? 'BOSON_AUTH_FAILED'
            : higgs && closeCode === 4429 ? 'BOSON_QUOTA_EXCEEDED' : 'OMNI_CONNECTION_CLOSED', { closeCode });
        });
        socket.on('unexpected-response', (_request, response) => {
          response.resume();
          const status = response.statusCode;
          fail(higgs && (status === 401 || status === 403) ? 'BOSON_AUTH_FAILED'
            : higgs && status === 429 ? 'BOSON_QUOTA_EXCEEDED' : 'OMNI_CONNECTION_REJECTED', { upstreamStatus: status });
        });
        const initializeHiggs = (instructions: string) => send('session.update', { session: {
          type: 'realtime', model: options.route.route.model, instructions,
          output_modalities: ['audio'],
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 16_000 },
              transcription: { model: 'higgs-stt-3.1' },
              turn_detection: {
                type: 'semantic_vad', silence_duration_ms: HIGGS_ENDPOINT_MS, threshold: 0.82, min_speech_duration: 0.08,
              },
            },
            output: { format: { type: 'audio/pcm', rate: 24_000 }, voice: options.route.voice },
          },
        } });
        if (higgs) {
          const instructions = options.restoreInstructions?.() ?? Promise.resolve(options.route.instructions);
          const connected = new Promise<void>(resolve => socket!.once('open', resolve));
          void Promise.all([instructions, connected]).then(([text]) => {
            if (!closed && !failed) initializeHiggs(text);
          }).catch(() => fail('OMNI_CONTEXT_FAILED'));
        }
        socket.on('message', (raw, binary) => {
          if (closed) return;
          try {
            if (binary) throw new Error('Unexpected Omni binary frame');
            const event = JSON.parse(raw.toString());
            if (event.type === 'error') {
              // Qwen may finish generation before a local cancellation reaches it.
              const lateCancellation = event.error?.type === 'invalid_request_error'
                && event.error?.message === 'Conversation has none active response';
              const managedLateCancellation = options.route.route.managed
                && event.error?.code === 'invalid_request_error'
                && event.error?.message === 'The voice provider rejected the request.';
              const higgsLateCancellation = higgs
                && ['response_not_active', 'response_id_mismatch'].includes(event.error?.code);
              if (Date.now() <= cancellationPendingUntil && (lateCancellation || managedLateCancellation || higgsLateCancellation)) {
                cancellationPendingUntil = 0;
                waitingForCancellation = undefined;
                maybeCreateResponse();
                return;
              }
              fail(higgs && [event.error?.code, event.error?.type].includes('insufficient_quota')
                ? 'BOSON_QUOTA_EXCEEDED' : 'OMNI_PROVIDER_ERROR'); return;
            }
            if (event.type === 'session.created' && !higgs) {
              send('session.update', { session: {
                modalities: ['text', 'audio'], voice: options.route.voice,
                instructions: options.route.instructions,
                ...(!options.route.route.managed ? { input_audio_format: 'pcm', output_audio_format: 'pcm', input_audio_transcription: { model: 'gummy-realtime-v1' } } : {}),
                turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: options.silenceDurationMs, create_response: options.route.route.managed, interrupt_response: false },
              } });
            } else if (event.type === (higgs ? 'session.created' : 'session.updated') && !ready) {
              if (options.route.route.managed && (event.session?.input_sample_rate !== 16000 || event.session?.output_sample_rate !== 24000)) throw new Error('Unsupported platform audio format');
              ready = true; clearTimeout(timer); rejectStart = undefined; resolve();
            } else if (event.type === 'input_audio_buffer.cleared') {
              clearingInput = false;
              clearTimeout(clearTimer);
            } else if (event.type === 'input_audio_buffer.speech_started') {
              lastInputAt = Date.now();
              const id = String(event.item_id);
              if (muted || clearingInput) { discardedInputs.add(id); return; }
              // Semantic VAD can resume an uncommitted segment with the same item ID.
              if (higgs ? speaking.has(id) : recorded.has(id) || pendingInputs.has(id)) return;
              if (!higgs) echoCandidates.remember(id, active?.audio ? active.text
                : recentPlayback && recentPlayback.expiresAt >= Date.now() ? recentPlayback.text : undefined);
              inputBlocked = false;
              pendingInputs.add(id);
              clearTimeout(responseStartTimer);
              turnSettled = false;
              speaking.add(id);
              if (!higgs) {
                turn.start(id);
                if (active && !active.published) cancel('barge_in');
              }
              options.send('input.speech_started', { utteranceId: id });
              if (higgs) {
                if (higgsEndpoint?.text !== undefined && higgsEndpoint.id !== id) writeInputTranscript(higgsEndpoint.id, higgsEndpoint.text);
                resetHiggsEndpoint();
                higgsEndpoint = { id };
                cancel('barge_in', true);
              }
            } else if (event.type === 'input_audio_buffer.speech_stopped') {
              lastInputAt = Date.now();
              const id = String(event.item_id);
              if (muted || inputBlocked || discardedInputs.has(id)) return;
              if (higgs) {
                if (higgsEndpoint?.id !== id || higgsEndpoint.stoppedAt !== undefined) return;
                higgsEndpoint.stoppedAt = Date.now();
              } else if (recorded.has(id)) return;
              speaking.delete(id);
              if (!higgs) turn.stop(id);
              options.send('input.speech_stopped', { utteranceId: id });
              if (higgs) settleHiggsEndpoint();
            } else if (higgs && event.type === 'input_audio_buffer.committed') {
              if (higgsEndpoint && higgsEndpoint.id === event.item_id) {
                higgsEndpoint.committedAt ??= Date.now();
                clearTimeout(responseStartTimer);
                if (!active) responseStartTimer = setTimeout(() => fail('OMNI_RESPONSE_START_TIMEOUT'), RESPONSE_START_TIMEOUT_MS);
                settleHiggsEndpoint();
              }
            } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
              if (typeof event.transcript !== 'string' || event.transcript.length > 32_000 || typeof event.item_id !== 'string') { fail('OMNI_INVALID_TRANSCRIPT'); return; }
              if (muted || inputBlocked || discardedInputs.has(event.item_id) || recorded.has(event.item_id)) return;
              const endpoint = higgsEndpoint?.id === event.item_id ? higgsEndpoint : undefined;
              // A resumed item can receive the previous segment's final transcript
              // before Boson commits the extended utterance.
              if (endpoint && endpoint.committedAt === undefined) return;
              pendingInputs.delete(event.item_id);
              speaking.delete(event.item_id);
              const text = event.transcript.trim();
              const playbackText = active?.audio ? active.text
                : recentPlayback && recentPlayback.expiresAt >= Date.now() ? recentPlayback.text : undefined;
              if (!higgs && echoCandidates.matches(event.item_id, text, playbackText)) {
                turn.final(event.item_id, '');
                log.debug({ sessionId: options.callId, responseId: active?.id, transcriptCharacters: text.length }, 'Ignored native voice playback echo');
                return;
              }
              if (!higgs && text && active?.published && options.bargeIn) {
                log.info({ sessionId: options.callId, responseId: active.id, utteranceId: event.item_id,
                  transcriptCharacters: text.length }, 'Confirmed user speech interrupted native voice playback');
                cancel('barge_in');
              }
              if (!higgs) turn.final(event.item_id, text);
              if (text) { lastInputAt = Date.now(); options.onUserInput?.(); }
              if (endpoint) {
                endpoint.text = event.transcript;
                settleHiggsEndpoint();
              } else writeInputTranscript(event.item_id, event.transcript);
            } else if (event.type === 'conversation.item.input_audio_transcription.failed') {
              if (muted || inputBlocked || discardedInputs.has(String(event.item_id))) return;
              // An endpoint cannot be certified without its transcript. Discard this turn, not the call.
              discardInput();
              options.send('session.error', { code: 'INPUT_DROPPED', message: 'Could not transcribe this voice turn. Please repeat it.', recoverable: true });
            } else if (event.type === 'response.created') {
              if (higgs && speaking.size) return;
              if (muted || inputBlocked) {
                cancellationPendingUntil = Date.now() + CANCELLATION_ERROR_GRACE_MS;
                send('response.cancel');
                return;
              }
              if (active) {
                // A provider-created reply must not replace audio still playing to the user.
                log.warn({ sessionId: options.callId, responseId: active.id }, 'Ignored overlapping native voice reply');
                cancellationPendingUntil = Date.now() + CANCELLATION_ERROR_GRACE_MS;
                send('response.cancel');
                return;
              }
              clearTimeout(responseStartTimer);
              const id = event.response?.id;
              if (typeof id !== 'string' || !id.length || id.length > 160) throw new Error('Invalid response ID');
              responseCreateQueued = false;
              waitingForCancellation = undefined;
              let release!: () => void;
              const settled = new Promise<void>((resolve) => { release = resolve; });
              active = { id, text: '', audio: false, generating: true, queuedBytes: 0, abort: new AbortController(), playback: new AudioPlaybackWindow(), tail: Promise.resolve(), published: false, settled, release, pcm: new PcmFrameBuffer() };
              if (turnSettled) publish(active);
            } else if (active && event.response_id === active.id && event.type === (higgs ? 'response.output_audio_transcript.delta' : 'response.audio_transcript.delta')) {
              if (typeof event.delta !== 'string' || active.text.length + event.delta.length > 32_000) { fail('OMNI_TRANSCRIPT_LIMIT'); return; }
              active.text += event.delta;
              if (active.published) options.send('response.text.delta', { responseId: active.id, delta: event.delta });
            } else if (active && event.response_id === active.id && event.type === (higgs ? 'response.output_audio.delta' : 'response.audio.delta')) {
              // Boson can emit an empty delta in the middle of an otherwise valid audio stream.
              if (higgs && event.delta === '') return;
              if (typeof event.delta !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(event.delta)) { fail('OMNI_INVALID_AUDIO'); return; }
              const audio = Buffer.from(event.delta, 'base64');
              if (!audio.length || audio.length % 2) { fail('OMNI_INVALID_AUDIO'); return; }
              const response = active;
              if (higgs && !response.higgsAudio) {
                if (typeof event.item_id !== 'string' || !Number.isInteger(event.content_index)) throw new Error('Invalid Higgs audio item');
                response.higgsAudio = { itemId: event.item_id, contentIndex: event.content_index, playedMs: 0 };
              }
              if (response.queuedBytes + audio.length > MAX_QUEUED_AUDIO_BYTES) { stopReply(response, 'OMNI_OUTPUT_BACKPRESSURE'); return; }
              response.queuedBytes += audio.length;
              response.tail = response.tail.then(async () => {
                await response.settled;
                for (const chunk of response.pcm.push(audio)) {
                  if (closed || active !== response) return;
                  await response.playback.reserve(chunk.length, response.abort.signal);
                  if (closed || active !== response) return;
                  if (!response.audio) { response.audio = true; options.send('response.audio.started', { responseId: response.id, format: { encoding: 'pcm_s16le', channels: 1, sampleRate: 24_000 } }); }
                  options.sendAudio(response.id, chunk);
                }
              }).catch(() => { if (!response.abort.signal.aborted) stopReply(response, 'OMNI_PLAYBACK_FAILED'); }).finally(() => { response.queuedBytes -= audio.length; });
            } else if (event.type === 'response.done' && active?.id === event.response?.id) {
              active.generating = false;
              if (event.response.status === 'cancelled') cancel('barge_in', true);
              else if (event.response.status !== 'completed') fail('OMNI_RESPONSE_FAILED');
              else {
                const response = active;
                void finish(response).catch(() => { if (!response.abort.signal.aborted) stopReply(response, 'OMNI_PLAYBACK_FAILED'); });
              }
            } else if (event.type === 'response.done' && event.response?.id === waitingForCancellation) {
              waitingForCancellation = undefined;
              maybeCreateResponse();
            } else if (higgs && event.type === 'session.idle_timeout') {
              void options.onClose('idle_timeout', true);
            } else if (higgs && event.type === 'session.max_duration_reached') {
              void options.onClose('session_limit', true);
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
    isConversationIdle() {
      return ready && !closed && !failed && !active && !speaking.size && !pendingInputs.size
        && !responseCreateQueued && !waitingForCancellation && !clearingInput && !inputBlocked
        && Date.now() - lastInputAt >= 750;
    },
    async commit() { throw new Error('Natural conversation uses automatic turn detection'); },
    cancel(responseId, reason) {
      if (active?.id !== responseId) return false;
      if (reason === 'client_cancelled') discardInput();
      return cancel(reason);
    },
    async cancelTask() { return false; },
    acknowledge(responseId, playedDurationMs) {
      if (active?.id !== responseId) return;
      active.playback.acknowledge(playedDurationMs * 48);
      if (active.higgsAudio) active.higgsAudio.playedMs = Math.max(active.higgsAudio.playedMs, playedDurationMs);
    },
    close() {
      if (closed) return writes;
      closed = true; cancel('session_closed'); clearTimeout(timer); clearTimeout(clearTimer); clearTimeout(uploadTimer);
      clearTimeout(responseStartTimer);
      if (higgsEndpoint?.text !== undefined) save({
        itemId: higgsEndpoint.id, role: 'user', text: higgsEndpoint.text, interrupted: false,
      });
      resetHiggsEndpoint();
      turn.reset(); echoCandidates.clear(); speaking.clear();
      inputQueue = []; queuedInputBytes = 0;
      rejectStart?.(new Error('Omni connection closed')); rejectStart = undefined;
      socket?.terminate();
      return writes;
    },
  };
  return engine;
}
