import crypto from 'node:crypto';
import type { StreamingSttSession, StreamingSttEvent } from '../../media-understanding/types.js';
import { createLogger } from '../../utils/logger.js';
import { speakStream } from '../tts/speak-core.js';
import { AudioPlaybackWindow } from './audio-playback-window.js';
import { SpeakableSegmenter } from './speakable-segmenter.js';
import type { VoiceTicketClaim, VoiceRealtimeRuntimeOptions } from './runtime.js';
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
  let queuedTurns = 0;
  let finalCount = 0;
  let finalCountAtLastCommit = 0;
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
      void options.runtime.recordInterruption({
        sessionKey,
        responseId: response.id,
        reason,
        generatedCharacters: response.text.length,
        interruptedDuring: response.audioStarted ? 'speaking' : 'thinking',
      }).catch((error) => {
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
    if (result.outputFormat !== 'pcm') {
      await result.release();
      throw new Error(`Realtime TTS returned unsupported format: ${result.outputFormat}`);
    }
    try {
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
    };
    activeResponse = response;
    send('response.created', { responseId: response.id });
    try {
      for await (const event of options.runtime.runAgent(
        text,
        claim.request.sessionKey,
        response.abortController.signal,
      )) {
        if (activeResponse !== response || response.abortController.signal.aborted) return;
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
        if (event.type === 'error') {
          throw new Error(typeof event.payload?.message === 'string' ? event.payload.message : 'Agent response failed');
        }
      }
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
    }
  }

  async function openSttSession(consumed: VoiceTicketClaim): Promise<StreamingSttSession> {
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
      signal: options.signal,
      onEvent: onSttEvent,
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
    if (event.type === 'speech_started') {
      if (claim.request.purpose === 'conversation' && claim.config.voice?.realtime?.bargeIn) {
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
      if (finalizedUtterances.has(event.utteranceId)) return;
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
        if (claim.config.voice?.realtime?.bargeIn) cancelActiveResponse('barge_in');
        if (queuedTurns >= 8) {
          send('session.error', { code: 'INPUT_BACKPRESSURE', message: 'Too many queued voice turns', recoverable: false });
          void options.onClose('input_backpressure', true);
          return;
        }
        queuedTurns += 1;
        conversationTail = conversationTail.then(() => runConversationTurn(text)).finally(() => { queuedTurns -= 1; });
      }
    }
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
    appendAudio(bytes) {
      if (closed || !sttSession || committing) throw new Error('Voice input is not ready');
      sttSession.appendAudio(bytes);
    },
    async commit() {
      if (claim.request.purpose !== 'dictation' || committing || !sttSession || closed) {
        throw new Error('Input cannot be committed');
      }
      committing = true;
      const before = finalCount;
      const alreadyFinalized = before > finalCountAtLastCommit;
      await sttSession.commit();
      if (closed) return;
      if (!alreadyFinalized && finalCount === before) {
        send('session.error', { code: 'EMPTY_UTTERANCE', message: 'No speech was recognized', recoverable: true });
      }
      finalCountAtLastCommit = finalCount;
      await options.onClose('input_committed', true);
    },
    cancel(responseId, reason) {
      return activeResponse?.id === responseId ? cancelActiveResponse(reason) : false;
    },
    acknowledge(responseId, playedBytes) {
      if (activeResponse?.id === responseId) activeResponse.playback.acknowledge(playedBytes);
    },
    close() {
      if (closed) return;
      closed = true;
      cancelActiveResponse('session_closed');
      sttSession?.abort('session_closed');
    },
  };
}
