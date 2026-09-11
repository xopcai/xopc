import crypto from 'node:crypto';
import type { StreamingSttSession, StreamingSttEvent } from '../../media-understanding/types.js';
import { createLogger } from '../../utils/logger.js';
import { speakStream, type SpeakStreamResult } from '../tts/speak-core.js';
import { AudioPlaybackWindow } from './audio-playback-window.js';
import { TurnCoordinator } from './turnPolicy.js';
import { isLikelyPlaybackEcho } from './playback-echo.js';
import { PcmFrameBuffer } from './pcmFrameBuffer.js';
import { SpeakableSegmenter } from './speakable-segmenter.js';
import type { VoiceTicketClaim, VoiceRealtimeRuntimeOptions } from './runtime.types.js';
import type { VoiceEngine, VoiceEventSink } from './engine.js';

const log = createLogger('Voice:Agent');
const AGENT_TTS_MAX_SEGMENT_CHARACTERS = 180;
const AGENT_TTS_MIN_SEGMENT_CHARACTERS = 24;

type SpeechOpening = Promise<{ result: SpeakStreamResult } | { error: unknown }>;

interface SpeechJob {
  phrase: string;
  characters: number;
  opening?: SpeechOpening;
}

interface ActiveVoiceResponse {
  id: string;
  playback: AudioPlaybackWindow;
  abortController: AbortController;
  segmenter: SpeakableSegmenter;
  text: string;
  audibleText: string;
  audioStarted: boolean;
  speechQueue: SpeechJob[];
  speechWorker?: Promise<void>;
  speechError?: Error;
  queuedSpeechCharacters: number;
  startedAt: number;
  firstTextSeen: boolean;
  awaitingClarification: boolean;
  taskId?: string;
  pcm: PcmFrameBuffer;
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
  let pendingTurn: { turnId: string; text: string; cancelled: boolean } | undefined;
  const turn = new TurnCoordinator(claim.silenceDurationMs, (text, decision, turnId) => {
    if (closed || muted) return;
    log.info({ sessionId: claim.sessionId, turnId, disposition: decision.disposition, confidence: decision.confidence,
      source: decision.source, transcriptCharacters: text.length }, 'Realtime voice turn committed');
    send('turn.decision', { turnId, disposition: decision.disposition, confidence: decision.confidence, source: decision.source, committed: true });
    send('turn.committed', { turnId });
    if (queuedTurns >= 8) {
      send('session.error', { code: 'INPUT_BACKPRESSURE', message: 'Too many queued voice turns', recoverable: false });
      void options.onClose('input_backpressure', true);
      return;
    }
    queuedTurns += 1;
    const generation = inputGeneration;
    const pending = { turnId, text, cancelled: false };
    pendingTurn = pending;
    conversationTail = conversationTail.then(() => {
      if (pendingTurn === pending) pendingTurn = undefined;
      if (generation === inputGeneration && !pending.cancelled) return runAssistantTurn(text, turnId);
    }).finally(() => { if (generation === inputGeneration) queuedTurns -= 1; });
  });
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

  function openSpeech(response: ActiveVoiceResponse, job: SpeechJob): SpeechOpening {
    if (job.opening) return job.opening;
    job.opening = speakStream(job.phrase, claim.tts!.config, {
      appConfig: claim.config,
      parseDirectives: false,
      signal: response.abortController.signal,
      allowFallback: false,
    }).then((result) => ({ result }), (error: unknown) => ({ error }));
    return job.opening;
  }

  function prefetchNextSpeech(response: ActiveVoiceResponse): void {
    const next = response.speechQueue[0];
    if (!next || next.opening || response.abortController.signal.aborted) return;
    openSpeech(response, next);
  }

  async function playSpeech(response: ActiveVoiceResponse, phrase: string, result: SpeakStreamResult): Promise<void> {
    let phraseMarkedAudible = false;
    try {
      if (response.abortController.signal.aborted || activeResponse !== response || closed) return;
      if (result.outputFormat !== 'pcm') throw new Error(`Realtime TTS returned unsupported format: ${result.outputFormat}`);
      const reader = result.audioStream.getReader();
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        if (response.abortController.signal.aborted || activeResponse !== response) return;
        if (!phraseMarkedAudible && item.value.byteLength > 0) {
          phraseMarkedAudible = true;
          response.audibleText = `${response.audibleText} ${phrase}`.trim().slice(-8_000);
        }
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
        for (const frame of response.pcm.push(item.value)) {
          await response.playback.reserve(frame.byteLength, response.abortController.signal);
          if (activeResponse !== response || closed) return;
          options.sendAudio(response.id, frame);
        }
      }
    } finally {
      await result.release();
    }
  }

  async function releaseQueuedSpeech(response: ActiveVoiceResponse): Promise<void> {
    const queued = response.speechQueue.splice(0);
    for (const job of queued) {
      response.queuedSpeechCharacters -= job.characters;
      if (!job.opening) continue;
      const opened = await job.opening;
      if ('result' in opened) await opened.result.release();
    }
  }

  async function runSpeechQueue(response: ActiveVoiceResponse): Promise<void> {
    try {
      while (!response.abortController.signal.aborted
        && !response.speechError
        && activeResponse === response
        && response.speechQueue.length > 0) {
        const job = response.speechQueue.shift()!;
        try {
          const opened = await openSpeech(response, job);
          if ('error' in opened) throw opened.error;
          if (response.abortController.signal.aborted || activeResponse !== response || closed) {
            await opened.result.release();
            return;
          }
          prefetchNextSpeech(response);
          await playSpeech(response, job.phrase, opened.result);
        } finally {
          response.queuedSpeechCharacters -= job.characters;
        }
      }
    } catch (error) {
      if (!response.abortController.signal.aborted) {
        response.speechError = error instanceof Error ? error : new Error(String(error));
      }
    } finally {
      await releaseQueuedSpeech(response);
    }
  }

  function startSpeechWorker(response: ActiveVoiceResponse): void {
    if (response.speechWorker || response.speechError || response.speechQueue.length === 0) return;
    const worker = runSpeechQueue(response).finally(() => {
      if (response.speechWorker !== worker) return;
      response.speechWorker = undefined;
      if (response.speechQueue.length > 0 && !response.speechError) startSpeechWorker(response);
    });
    response.speechWorker = worker;
  }

  async function waitForSpeech(response: ActiveVoiceResponse): Promise<void> {
    while (response.speechWorker) await response.speechWorker;
  }

  function queuePhrases(response: ActiveVoiceResponse, phrases: string[]): void {
    for (const phrase of phrases) {
      if (response.speechError || response.abortController.signal.aborted) return;
      if (response.queuedSpeechCharacters + phrase.length > 8_000) {
        response.speechError = new Error('Voice synthesis queue limit reached');
        return;
      }
      response.queuedSpeechCharacters += phrase.length;
      const previous = response.speechQueue.at(-1);
      if (previous && !previous.opening
        && previous.phrase.length + phrase.length + 1 <= AGENT_TTS_MAX_SEGMENT_CHARACTERS) {
        previous.phrase = `${previous.phrase} ${phrase}`;
        previous.characters += phrase.length;
      } else {
        response.speechQueue.push({ phrase, characters: phrase.length });
      }
    }
    if (response.speechWorker) prefetchNextSpeech(response);
    else startSpeechWorker(response);
  }

  async function runAssistantTurn(text: string, turnId: string): Promise<void> {
    if (!claim.tts || !claim.request.sessionKey || !text.trim() || closed) return;
    cancelActiveResponse('barge_in');
    const response: ActiveVoiceResponse = {
      id: `resp_${crypto.randomUUID()}`,
      playback: new AudioPlaybackWindow(),
      abortController: new AbortController(),
      segmenter: new SpeakableSegmenter(
        AGENT_TTS_MAX_SEGMENT_CHARACTERS,
        AGENT_TTS_MIN_SEGMENT_CHARACTERS,
        0,
      ),
      text: '',
      audibleText: '',
      audioStarted: false,
      speechQueue: [],
      queuedSpeechCharacters: 0,
      startedAt: Date.now(),
      firstTextSeen: false,
      awaitingClarification: false,
      pcm: new PcmFrameBuffer(),
    };
    activeResponse = response;
    send('response.created', { responseId: response.id });
    try {
      await interruptionWrites;
      if (response.abortController.signal.aborted || closed) return;
      if (!claim.conversationSessionId) throw new Error('Conversation identity is unavailable');
      const task = await options.runtime.agentBroker.delegate({ text, turnId, sessionKey: claim.request.sessionKey,
        expectedSessionId: claim.conversationSessionId, signal: response.abortController.signal });
      response.taskId = task.taskId;
      send('task.created', { responseId: response.id, taskId: task.taskId });
      for await (const event of task.events) {
        if (activeResponse !== response || response.abortController.signal.aborted) return;
        if (event.type === 'assistant_delta'
          || (event.type === 'tool_end' && event.payload?.toolName !== 'clarify')) {
          response.awaitingClarification = false;
        }
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
        if (event.type === 'tool_start') {
          // Agents commonly announce a tool without punctuation. Do not hold that
          // useful acknowledgement until the tool finishes or the whole turn ends.
          queuePhrases(response, response.segmenter.flush());
        }
        if ((event.type === 'tool_start' || event.type === 'tool_end') && typeof event.payload?.toolCallId === 'string' && typeof event.payload?.toolName === 'string') {
          send('task.activity', { taskId: task.taskId, toolCallId: event.payload.toolCallId.slice(0, 160), toolName: event.payload.toolName.slice(0, 256), status: event.type === 'tool_start' ? 'running' : event.payload.status === 'error' ? 'failed' : 'completed' });
        }
        if (event.type === 'stream_end') {
          const status = event.payload?.status;
          send('task.done', { taskId: task.taskId, status: status === 'cancelled' ? 'cancelled' : status === 'suspended' ? 'suspended' : status === 'error' ? 'failed' : 'completed' });
        }
        if (event.type === 'clarify_request' && typeof event.payload?.requestId === 'string' && typeof event.payload?.question === 'string') {
          response.awaitingClarification = true;
          send('response.clarification', {
            responseId: response.id,
            requestId: event.payload.requestId.slice(0, 160),
            kind: event.payload.kind === 'approval' ? 'approval' : 'input',
            question: event.payload.question.slice(0, 8_000),
            ...(Array.isArray(event.payload.choices) ? { choices: event.payload.choices.filter((choice): choice is string => typeof choice === 'string').slice(0, 20).map((choice) => choice.slice(0, 1_000)) } : {}),
            ...(typeof event.payload.suggestedAnswer === 'string' ? { suggestedAnswer: event.payload.suggestedAnswer.slice(0, 1_000) } : {}),
            version: typeof event.payload.version === 'number' ? event.payload.version : 1,
            createdAt: typeof event.payload.createdAt === 'number' ? event.payload.createdAt : Date.now(),
            ...(typeof event.payload.expiresAt === 'number' ? { expiresAt: event.payload.expiresAt } : {}),
          });
        }
        if (event.type === 'error') {
          throw new Error(typeof event.payload?.message === 'string' ? event.payload.message : 'Agent response failed');
        }
      }
      if (activeResponse !== response || response.abortController.signal.aborted || closed) return;
      queuePhrases(response, response.segmenter.flush());
      send('response.text.done', { responseId: response.id });
      await waitForSpeech(response);
      if (response.speechError) throw response.speechError;
      const finalFrame = response.pcm.finish();
      if (finalFrame) {
        await response.playback.reserve(finalFrame.byteLength, response.abortController.signal);
        if (activeResponse !== response || closed) return;
        options.sendAudio(response.id, finalFrame);
      }
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
      await waitForSpeech(response);
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

  function bufferFinal(utteranceId: string, text: string): void {
    try { turn.final(utteranceId, text); } catch {
      send('session.error', { code: 'INPUT_BACKPRESSURE', message: 'Voice turn input limit reached', recoverable: false });
      void options.onClose('input_backpressure', true);
    }
  }

  function onSttEvent(event: StreamingSttEvent): void {
    if (closed) return;
    if (event.type === 'ready' || event.type === 'usage') return;
    if (event.type === 'error') {
      turn.reset();
      log.warn({ err: event.error, sessionId: claim.sessionId, provider: stt!.route.provider }, 'Realtime STT failed');
      send('session.error', { code: 'PROVIDER_ERROR', message: 'Streaming transcription failed', recoverable: false });
      void options.onClose('provider_error', true);
      return;
    }
    if (muted || finalizedUtterances.has(event.utteranceId)) return;
    if (event.type === 'speech_started') {
      if (claim.request.purpose === 'conversation') {
        if (pendingTurn) {
          pendingTurn.cancelled = true;
          turn.restore(pendingTurn.turnId, pendingTurn.text);
          pendingTurn = undefined;
        }
        turn.start(event.utteranceId);
      }
      send('input.speech_started', { utteranceId: event.utteranceId });
    }
    if (event.type === 'speech_stopped') {
      if (claim.request.purpose === 'conversation') turn.stop(event.utteranceId);
      send('input.speech_stopped', { utteranceId: event.utteranceId });
    }
    if (event.type === 'transcript_delta') {
      send('input.transcript.delta', {
        utteranceId: event.utteranceId,
        revision: event.revision,
        text: event.text,
      });
    }
    if (event.type === 'transcript_final') {
      const text = event.text.trim();
      if (!text) {
        if (claim.request.purpose === 'conversation') bufferFinal(event.utteranceId, '');
        return;
      }
      if (finalizedUtterances.size >= 10_000) {
        void options.onClose('utterance_limit', true);
        return;
      }
      finalizedUtterances.add(event.utteranceId);
      finalCount += 1;
      if (claim.request.purpose === 'conversation'
        && activeResponse?.audioStarted
        && isLikelyPlaybackEcho(text, activeResponse.audibleText)) {
        bufferFinal(event.utteranceId, '');
        log.debug({
          sessionId: claim.sessionId,
          responseId: activeResponse.id,
          transcriptCharacters: text.length,
        }, 'Ignored finalized transcription matching active voice playback');
        return;
      }
      send('input.transcript.final', {
        utteranceId: event.utteranceId,
        revision: event.revision,
        text,
        ...(event.language === 'zh' || event.language === 'en' ? { language: event.language } : {}),
      });
      if (claim.request.purpose === 'conversation') {
        if (activeResponse?.awaitingClarification) { turn.reset(); return; }
        // Partial ASR hypotheses can be caused by ambient noise or playback and
        // may disappear without a final transcript. Only committed speech may
        // destructively cancel an in-flight Agent response.
        if (claim.config.voice?.realtime?.bargeIn) cancelActiveResponse('barge_in');
        bufferFinal(event.utteranceId, text);
      }
    }
  }


  function discardInput(): Promise<void> {
    turn.reset();
    pendingTurn = undefined;
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
    cancelTask(taskId) { return options.runtime.agentBroker.cancel(taskId); },
    acknowledge(responseId, playedDurationMs) {
      if (activeResponse?.id === responseId) activeResponse.playback.acknowledge(playedDurationMs * 48);
    },
    close() {
      if (closing) return closing;
      closed = true;
      turn.reset();
      cancelActiveResponse('session_closed');
      sttAbort.abort('session_closed');
      sttSession?.abort('session_closed');
      closing = Promise.all([conversationTail, interruptionWrites, inputReset]).then(() => {});
      return closing;
    },
  };
}
