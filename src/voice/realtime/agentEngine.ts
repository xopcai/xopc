import crypto from 'node:crypto';
import type { StreamingSttSession, StreamingSttEvent } from '../../media-understanding/types.js';
import { createLogger } from '../../utils/logger.js';
import { speakStream } from '../tts/speak-core.js';
import { AudioPlaybackWindow } from './audio-playback-window.js';
import { SpeakableSegmenter } from './speakable-segmenter.js';
import type { VoiceTicketClaim, VoiceRealtimeRuntimeOptions } from './runtime.types.js';
import type { VoiceEngine, VoiceEventSink } from './engine.js';

const log = createLogger('Voice:Agent');
interface ActiveVoiceResponse {
  id: string;
  playback: AudioPlaybackWindow;
  abortController: AbortController;
  segmenter: SpeakableSegmenter;
  text: string;
  audioStarted: boolean;
  speechTail: Promise<void>;
  speechError?: Error;
  queuedSpeechCharacters: number;
  startedAt: number;
  firstTextSeen: boolean;
  awaitingClarification: boolean;
}

export function createAgentVoiceEngine(options: {
  claim: VoiceTicketClaim;
  runtime: VoiceRealtimeRuntimeOptions;
  signal: AbortSignal;
  send: VoiceEventSink;
  sendAudio: (responseId: string, bytes: Uint8Array) => void;
  onClose: (reason: string, notify: boolean) => Promise<void>;
}): VoiceEngine {
  const claim = options.claim;
  const stt = claim.stt;
  if (!stt) throw new Error('Agent voice requires a transcription route');
  const send = options.send;
  let closed = false;
  let sttSession: StreamingSttSession | undefined;
  let activeResponse: ActiveVoiceResponse | undefined;
  let conversationTail = Promise.resolve();
  let interruptionWrites = Promise.resolve();
  let closing: Promise<void> | undefined;
  let queuedTurns = 0;
  let inputGeneration = 0;
  let muted = false;
  let sttGeneration = 0;
  let sttAbort = new AbortController();
  let inputReset: Promise<void> | undefined;
  let bufferedAudio: Uint8Array[] = [];
  let bufferedBytes = 0;
  let finalCount = 0;
  let committing = false;
  const finalizedUtterances = new Set<string>();
  function cancelActiveResponse(reason: 'barge_in' | 'client_cancelled' | 'session_closed'): boolean {
    const response = activeResponse;
    if (!response) return false;
    activeResponse = undefined;
    response.abortController.abort(reason);
    send('response.cancelled', { responseId: response.id, reason });
    const sessionKey = claim.request.sessionKey;
    if (sessionKey && reason !== 'session_closed') {
      interruptionWrites = interruptionWrites.then(() => options.runtime.recordInterruption({
        sessionKey,
        responseId: response.id,
        reason,
        generatedCharacters: response.text.length,
        interruptedDuring: response.audioStarted ? 'speaking' : 'thinking',
      })).catch((error) => {
        log.warn({ err: error, sessionId: claim.sessionId, responseId: response.id }, 'Voice interruption audit failed');
      });
    }
    return true;
  }

  async function speakPhrase(response: ActiveVoiceResponse, phrase: string): Promise<void> {
    if (!claim.tts || response.abortController.signal.aborted) return;
    const result = await speakStream(phrase, claim.tts.config, {
      appConfig: claim.config,
      parseDirectives: false,
      signal: response.abortController.signal,
      allowFallback: false,
    });
    try {
      if (response.abortController.signal.aborted || activeResponse !== response || closed) return;
      if (result.outputFormat !== 'pcm') throw new Error(`Realtime TTS returned unsupported format: ${result.outputFormat}`);
      const reader = result.audioStream.getReader();
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        if (response.abortController.signal.aborted || activeResponse !== response) return;
        if (!response.audioStarted) {
          response.audioStarted = true;
          log.info({
            sessionId: claim.sessionId,
            responseId: response.id,
            latencyMs: Date.now() - response.startedAt,
          }, 'Realtime voice first audio ready');
          send('response.audio.started', {
            responseId: response.id,
            format: { encoding: 'pcm_s16le', sampleRate: 24_000, channels: 1 },
          });
        }
        // Half-second frames keep acknowledgements flowing within the playback window.
        for (let offset = 0; offset < item.value.byteLength; offset += 24_000) {
          const chunk = item.value.subarray(offset, offset + 24_000);
          await response.playback.reserve(chunk.byteLength, response.abortController.signal);
          if (activeResponse !== response || closed) return;
          options.sendAudio(response.id, chunk);
        }
      }
    } finally {
      await result.release();
    }
  }

  function queuePhrases(response: ActiveVoiceResponse, phrases: string[]): void {
    for (const phrase of phrases) {
      if (response.speechError || response.abortController.signal.aborted) return;
      if (response.queuedSpeechCharacters + phrase.length > 8_000) {
        response.speechError = new Error('Voice synthesis queue limit reached');
        return;
      }
      response.queuedSpeechCharacters += phrase.length;
      response.speechTail = response.speechTail
        .then(async () => {
          if (response.speechError || response.abortController.signal.aborted) return;
          try {
            await speakPhrase(response, phrase);
          } catch (error) {
            if (!response.abortController.signal.aborted) {
              response.speechError = error instanceof Error ? error : new Error(String(error));
            }
          }
        }).finally(() => { response.queuedSpeechCharacters -= phrase.length; });
    }
  }

  async function runConversationTurn(text: string): Promise<void> {
    if (!claim.tts || !claim.request.sessionKey || !text.trim() || closed) return;
    cancelActiveResponse('barge_in');
    const response: ActiveVoiceResponse = {
      id: `resp_${crypto.randomUUID()}`,
      playback: new AudioPlaybackWindow(),
      abortController: new AbortController(),
      segmenter: new SpeakableSegmenter(),
      text: '',
      audioStarted: false,
      speechTail: Promise.resolve(),
      queuedSpeechCharacters: 0,
      startedAt: Date.now(),
      firstTextSeen: false,
      awaitingClarification: false,
    };
    activeResponse = response;
    send('response.created', { responseId: response.id });
    try {
      await interruptionWrites;
      if (response.abortController.signal.aborted || closed) return;
      for await (const event of options.runtime.runAgent(
        text,
        claim.request.sessionKey,
        response.abortController.signal,
      )) {
        if (activeResponse !== response || response.abortController.signal.aborted) return;
        if (event.type === 'assistant_delta' || event.type === 'tool_end') response.awaitingClarification = false;
        if (event.type === 'assistant_delta' && typeof event.payload?.delta === 'string') {
          if (response.text.length + event.payload.delta.length > 32_000) throw new Error('Voice response text limit reached');
          if (!response.firstTextSeen) {
            response.firstTextSeen = true;
            log.info({
              sessionId: claim.sessionId,
              responseId: response.id,
              latencyMs: Date.now() - response.startedAt,
            }, 'Realtime voice first response text ready');
          }
          response.text += event.payload.delta;
          send('response.text.delta', { responseId: response.id, delta: event.payload.delta });
          queuePhrases(response, response.segmenter.push(event.payload.delta));
        }
        if ((event.type === 'tool_start' || event.type === 'tool_end') && typeof event.payload?.toolCallId === 'string' && typeof event.payload?.toolName === 'string') {
          send('response.activity', { responseId: response.id, toolCallId: event.payload.toolCallId.slice(0, 160), toolName: event.payload.toolName.slice(0, 256), status: event.type === 'tool_start' ? 'running' : event.payload.status === 'error' ? 'failed' : 'completed' });
        }
        if (event.type === 'clarify_request' && typeof event.payload?.requestId === 'string' && typeof event.payload?.question === 'string') {
          response.awaitingClarification = true;
          send('response.clarification', { responseId: response.id, requestId: event.payload.requestId.slice(0, 160), question: event.payload.question.slice(0, 8_000), ...(Array.isArray(event.payload.choices) ? { choices: event.payload.choices.filter((choice): choice is string => typeof choice === 'string').slice(0, 20).map((choice) => choice.slice(0, 1_000)) } : {}) });
        }
        if (event.type === 'error') {
          throw new Error(typeof event.payload?.message === 'string' ? event.payload.message : 'Agent response failed');
        }
      }
      if (activeResponse !== response || response.abortController.signal.aborted || closed) return;
      queuePhrases(response, response.segmenter.flush());
      send('response.text.done', { responseId: response.id });
      await response.speechTail;
      if (response.speechError) throw response.speechError;
      await response.playback.drain(response.abortController.signal);
      if (activeResponse !== response || response.abortController.signal.aborted) return;
      if (response.audioStarted) send('response.audio.done', { responseId: response.id });
      send('response.done', {
        responseId: response.id,
        finishReason: response.audioStarted ? 'completed' : 'text_only',
        audio: response.audioStarted,
      });
      activeResponse = undefined;
    } catch (error) {
      if (response.abortController.signal.aborted || closed) return;
      log.warn({ err: error, sessionId: claim.sessionId, responseId: response.id }, 'Realtime voice response failed');
      send('session.error', { code: 'RESPONSE_FAILED', message: 'Voice response failed', recoverable: true });
      if (response.audioStarted) send('response.audio.done', { responseId: response.id });
      send('response.done', {
        responseId: response.id,
        finishReason: response.audioStarted ? 'audio_partial' : 'text_only',
        audio: response.audioStarted,
      });
      response.abortController.abort('provider_error');
      if (activeResponse === response) activeResponse = undefined;
    } finally {
      await response.speechTail;
    }
  }

  async function openSttSession(consumed: VoiceTicketClaim): Promise<StreamingSttSession> {
    const generation = sttGeneration;
    return stt!.plugin.openAudioStream({
      model: stt!.model,
      inputFormat: { encoding: 'pcm_s16le', sampleRate: 16_000, channels: 1 },
      ...(stt!.apiKey ? { apiKey: stt!.apiKey } : {}),
      ...(stt!.baseUrl ? { baseUrl: stt!.baseUrl } : {}),
      ...(stt!.headers ? { headers: stt!.headers } : {}),
      ...(stt!.language ? { language: stt!.language } : {}),
      ...(stt!.prompt ? { prompt: stt!.prompt } : {}),
      turnDetection: {
        mode: consumed.inputMode,
        silenceDurationMs: consumed.silenceDurationMs,
      },
      timeoutMs: 15_000,
      signal: AbortSignal.any([options.signal, sttAbort.signal]),
      onEvent: (event) => { if (generation === sttGeneration) onSttEvent(event); },
    });
  }

  function onSttEvent(event: StreamingSttEvent): void {
    if (closed) return;
    if (event.type === 'ready' || event.type === 'usage') return;
    if (event.type === 'error') {
      log.warn({ err: event.error, sessionId: claim.sessionId, provider: stt!.route.provider }, 'Realtime STT failed');
      send('session.error', { code: 'PROVIDER_ERROR', message: 'Streaming transcription failed', recoverable: false });
      void options.onClose('provider_error', true);
      return;
    }
    if (muted || finalizedUtterances.has(event.utteranceId)) return;
    if (event.type === 'speech_started') {
      if (claim.request.purpose === 'conversation' && claim.config.voice?.realtime?.bargeIn && !activeResponse?.awaitingClarification) {
        cancelActiveResponse('barge_in');
      }
      send('input.speech_started', { utteranceId: event.utteranceId });
    }
    if (event.type === 'speech_stopped') send('input.speech_stopped', { utteranceId: event.utteranceId });
    if (event.type === 'transcript_delta') {
      send('input.transcript.delta', {
        utteranceId: event.utteranceId,
        revision: event.revision,
        text: event.text,
      });
    }
    if (event.type === 'transcript_final') {
      const text = event.text.trim();
      if (!text) return;
      if (finalizedUtterances.size >= 10_000) {
        void options.onClose('utterance_limit', true);
        return;
      }
      finalizedUtterances.add(event.utteranceId);
      finalCount += 1;
      send('input.transcript.final', {
        utteranceId: event.utteranceId,
        revision: event.revision,
        text,
        ...(event.language === 'zh' || event.language === 'en' ? { language: event.language } : {}),
      });
      if (claim.request.purpose === 'conversation') {
        if (activeResponse?.awaitingClarification) return;
        if (claim.config.voice?.realtime?.bargeIn) cancelActiveResponse('barge_in');
        if (queuedTurns >= 8) {
          send('session.error', { code: 'INPUT_BACKPRESSURE', message: 'Too many queued voice turns', recoverable: false });
          void options.onClose('input_backpressure', true);
          return;
        }
        queuedTurns += 1;
        const generation = inputGeneration;
        conversationTail = conversationTail.then(() => {
          if (generation === inputGeneration) return runConversationTurn(text);
        }).finally(() => { if (generation === inputGeneration) queuedTurns -= 1; });
      }
    }
  }


  function discardInput(): Promise<void> {
    inputGeneration += 1;
    queuedTurns = 0;
    bufferedAudio = [];
    bufferedBytes = 0;
    const generation = ++sttGeneration;
    sttAbort.abort('input_discarded');
    sttAbort = new AbortController();
    sttSession?.abort('input_discarded');
    sttSession = undefined;
    // Restart only transcription; the Chat and current reply remain alive.
    inputReset = openSttSession(claim).then((opened) => {
      if (closed || generation !== sttGeneration) { opened.abort('input_replaced'); return; }
      sttSession = opened;
      for (const bytes of bufferedAudio) opened.appendAudio(bytes);
      bufferedAudio = [];
      bufferedBytes = 0;
    }).catch((error) => { if (!closed && generation === sttGeneration) throw error; });
    return inputReset;
  }

  return {
    async start() {
      const opened = await openSttSession(claim);
      if (closed || options.signal.aborted) {
        opened.abort('session_closed');
        throw new Error('Voice session closed during initialization');
      }
      sttSession = opened;
    },
    async setInputMuted(next) {
      if (closed || muted === next) return;
      muted = next;
      if (!next) return inputReset;
      return discardInput();
    },
    appendAudio(bytes) {
      if (muted) return;
      if (!closed && !sttSession && inputReset) {
        if (bufferedBytes + bytes.byteLength > 64_000) throw new Error('Voice input reset exceeded audio buffer');
        bufferedAudio.push(Uint8Array.from(bytes));
        bufferedBytes += bytes.byteLength;
        return;
      }
      if (closed || !sttSession || committing) throw new Error('Voice input is not ready');
      sttSession.appendAudio(bytes);
    },
    async commit() {
      if (claim.request.purpose !== 'dictation' || committing || !sttSession || closed) {
        throw new Error('Input cannot be committed');
      }
      committing = true;
      await sttSession.commit();
      if (closed) return;
      if (finalCount === 0) {
        send('session.error', { code: 'EMPTY_UTTERANCE', message: 'No speech was recognized', recoverable: true });
      }
      await options.onClose('input_committed', true);
    },
    cancel(responseId, reason) {
      if (activeResponse?.id !== responseId) return false;
      if (reason === 'client_cancelled') {
        void discardInput().catch((error) => {
          log.warn({ err: error, sessionId: claim.sessionId }, 'Voice input reset after interruption failed');
          send('session.error', { code: 'PROVIDER_ERROR', message: 'Could not resume microphone input', recoverable: false });
          void options.onClose('provider_error', true);
        });
      }
      return cancelActiveResponse(reason);
    },
    acknowledge(responseId, playedBytes) {
      if (activeResponse?.id === responseId) activeResponse.playback.acknowledge(playedBytes);
    },
    close() {
      if (closing) return closing;
      closed = true;
      cancelActiveResponse('session_closed');
      sttAbort.abort('session_closed');
      sttSession?.abort('session_closed');
      closing = Promise.all([conversationTail, interruptionWrites, inputReset]).then(() => {});
      return closing;
    },
  };
}
