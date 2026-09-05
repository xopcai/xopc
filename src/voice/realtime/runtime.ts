import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import type { Socket } from 'node:net';

import {
  VOICE_REALTIME_HEARTBEAT_INTERVAL_MS,
  VOICE_REALTIME_MAX_BINARY_FRAME_BYTES,
  VOICE_REALTIME_PROTOCOL_VERSION,
  VOICE_REALTIME_START_TIMEOUT_MS,
  VOICE_REALTIME_WS_PATH,
  parseVoiceClientJsonFrame,
  parseVoiceClientMessage,
  type CreateVoiceSessionRequest,
  type CreateVoiceSessionResponse,
  type VoiceClientMessage,
  type VoiceProviderRoute,
  type VoiceServerEvent,
} from '@xopcai/realtime-protocol/voice';
import { WebSocket as WebSocketState, type RawData, type WebSocket } from 'ws';

import type { Config } from '../../config/schema.js';
import { getMediaUnderstandingProvider } from '../../media-understanding/registry.js';
import type {
  MediaUnderstandingProvider,
  StreamingSttEvent,
  StreamingSttSession,
} from '../../media-understanding/types.js';
import { createPreauthConnectionBudget } from '../../gateway/security/preauth-connection-budget.js';
import { createLogger } from '../../utils/logger.js';
import { mergeSttConfigFromAppConfig } from '../stt/config.js';
import { resolveSTTProviderChain } from '../stt/factory.js';
import { getModelCatalogStore } from '../../providers/model-catalog-store.js';
import { mergeTtsConfigFromAppConfig } from '../tts/merge-config.js';
import { resolveSpeechProviderChain, type ResolvedSpeechProvider } from '../tts/factory.js';
import { speakStream } from '../tts/speak-core.js';
import type { TTSConfig } from '../tts/types.js';
import { ALIBABA_REALTIME_TTS_MODEL } from '../tts/providers/alibaba-speech.js';
import { SpeakableSegmenter } from './speakable-segmenter.js';
import { AudioPlaybackWindow } from './audio-playback-window.js';

const { WebSocketServer } = createRequire(import.meta.url)('ws') as typeof import('ws');
const log = createLogger('Voice:Realtime');
const TICKET_TTL_MS = 60_000;
const MAX_OUTSTANDING_TICKETS = 200;
const MAX_CONNECTIONS = 50;
const MAX_CONNECTIONS_PER_PRINCIPAL = 2;
const MAX_CLOCK_SKEW_MS = 60_000;

interface ResolvedStreamingStt {
  plugin: MediaUnderstandingProvider & Required<Pick<MediaUnderstandingProvider, 'openAudioStream' | 'streamingAudio'>>;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  language?: string;
  prompt?: string;
  route: VoiceProviderRoute;
}

interface VoiceTicketClaim {
  sessionId: string;
  principalId: string;
  request: CreateVoiceSessionRequest;
  inputMode: 'server_vad';
  idleTimeoutMs: number;
  maxSessionMs: number;
  silenceDurationMs: number;
  stt: ResolvedStreamingStt;
  tts?: ResolvedStreamingTts;
  config: Config;
  createdAt: number;
  expiresAt: number;
}

interface ResolvedStreamingTts {
  provider: ResolvedSpeechProvider;
  config: TTSConfig;
  route: VoiceProviderRoute;
}

export type VoiceSessionCreationErrorCode =
  | 'VOICE_DISABLED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_CONFLICT'
  | 'SESSION_LIMIT'
  | 'PROVIDER_UNAVAILABLE';

export class VoiceSessionCreationError extends Error {
  constructor(
    readonly code: VoiceSessionCreationErrorCode,
    message: string,
    readonly status: 404 | 409 | 429 | 503,
  ) {
    super(message);
    this.name = 'VoiceSessionCreationError';
  }
}

interface VoiceAgentEvent {
  type: string;
  payload?: { delta?: unknown; message?: unknown; status?: unknown };
}

interface ActiveVoiceResponse {
  id: string;
  playback: AudioPlaybackWindow;
  abortController: AbortController;
  segmenter: SpeakableSegmenter;
  text: string;
  audioStarted: boolean;
  speechTail: Promise<void>;
  speechError?: Error;
  startedAt: number;
  firstTextSeen: boolean;
}

export interface VoiceRealtimeRuntimeOptions {
  getConfig: () => Config;
  sessionExists: (sessionKey: string) => Promise<boolean>;
  sessionBusy: (sessionKey: string) => boolean;
  runAgent: (text: string, sessionKey: string, signal: AbortSignal) => AsyncIterable<VoiceAgentEvent>;
  recordInterruption: (entry: {
    sessionKey: string;
    responseId: string;
    reason: 'barge_in' | 'client_cancelled';
    generatedCharacters: number;
    interruptedDuring: 'thinking' | 'speaking';
  }) => Promise<void>;
}

function ticketKey(ticket: string): string {
  return crypto.createHash('sha256').update(ticket).digest('hex');
}

function isStreamingProvider(
  provider: MediaUnderstandingProvider | undefined,
): provider is ResolvedStreamingStt['plugin'] {
  return Boolean(provider?.streamingAudio && provider.openAudioStream);
}

function resolveStreamingStt(config: Config, language?: string): ResolvedStreamingStt | undefined {
  const sttConfig = mergeSttConfigFromAppConfig(config.tools?.media?.audio, config.tools?.media);
  for (const entry of resolveSTTProviderChain(sttConfig)) {
    const plugin = getMediaUnderstandingProvider(entry.id);
    if (!isStreamingProvider(plugin)) continue;
    const model = plugin.streamingAudio.defaultModel;
    return {
      plugin,
      model,
      ...(entry.apiKey ? { apiKey: entry.apiKey } : {}),
      ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
      ...(entry.headers ? { headers: entry.headers } : {}),
      ...(language ?? entry.language ? { language: language ?? entry.language } : {}),
      ...(entry.prompt ? { prompt: entry.prompt } : {}),
      route: { provider: plugin.id, model, managed: plugin.id === 'xopc-cloud' },
    };
  }
  return undefined;
}

function resolveStreamingTts(config: Config): ResolvedStreamingTts | undefined {
  const effective = mergeTtsConfigFromAppConfig(config.messages?.tts);
  if (!effective.enabled) return undefined;
  let chain: ResolvedSpeechProvider[];
  try {
    chain = resolveSpeechProviderChain(effective);
  } catch {
    return undefined;
  }
  for (const provider of chain) {
    if (typeof provider.plugin.synthesizeStream !== 'function') continue;
    let model: string | undefined;
    if (provider.plugin.id === 'alibaba') {
      model = ALIBABA_REALTIME_TTS_MODEL;
    } else if (provider.plugin.id === 'xopc-cloud') {
      const candidate = typeof provider.providerConfig.model === 'string'
        ? provider.providerConfig.model
        : undefined;
      const catalogModel = getModelCatalogStore().getSource('xopc-cloud')?.models.find(
        (entry) => entry.id === candidate,
      );
      if (!catalogModel?.tts?.streaming || !catalogModel.tts.outputFormats.includes('pcm')) continue;
      model = candidate;
    } else {
      continue;
    }
    if (!model) continue;
    const rawSlice = effective.providers?.[provider.plugin.id] ?? {};
    const frozen: TTSConfig = {
      ...effective,
      enabled: true,
      provider: provider.plugin.id,
      managedAuto: false,
      trigger: 'always',
      fallback: { enabled: false, order: [] },
      summarization: { enabled: false },
      modelOverrides: { enabled: false },
      providers: { [provider.plugin.id]: { ...rawSlice, model } },
    };
    return {
      provider,
      config: frozen,
      route: { provider: provider.plugin.id, model, managed: provider.plugin.id === 'xopc-cloud' },
    };
  }
  return undefined;
}

function rawText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return data.toString('utf8');
}

export class VoiceRealtimeRuntime {
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: VOICE_REALTIME_MAX_BINARY_FRAME_BYTES,
    perMessageDeflate: false,
  });
  private readonly tickets = new Map<string, VoiceTicketClaim>();
  private readonly preauthBudget = createPreauthConnectionBudget();
  private readonly socketsByPrincipal = new Map<string, Set<WebSocket>>();
  private readonly conversationReservations = new Map<string, string>();
  private closed = false;

  constructor(private readonly options: VoiceRealtimeRuntimeOptions) {
    this.wss.on('connection', (socket, request) => this.handleConnection(socket, request));
    this.wss.on('error', (err) => log.error({ err }, 'Voice WebSocket server failed'));
  }

  async createSession(
    request: CreateVoiceSessionRequest,
    principalId: string,
    now = Date.now(),
  ): Promise<CreateVoiceSessionResponse> {
    const config = structuredClone(this.options.getConfig());
    this.pruneTickets(now);
    if (!config.voice?.realtime?.enabled) {
      throw new VoiceSessionCreationError('VOICE_DISABLED', 'Realtime voice is disabled', 503);
    }
    const stt = resolveStreamingStt(config, request.language);
    if (!stt) {
      throw new VoiceSessionCreationError(
        'PROVIDER_UNAVAILABLE',
        'No configured streaming speech-to-text provider is available',
        503,
      );
    }
    const inputMode = 'server_vad' as const;
    if (!stt.plugin.streamingAudio.turnDetection.includes(inputMode)) {
      throw new VoiceSessionCreationError(
        'PROVIDER_UNAVAILABLE',
        `Streaming speech-to-text provider does not support ${inputMode}`,
        503,
      );
    }
    const tts = request.purpose === 'conversation' ? resolveStreamingTts(config) : undefined;
    if (request.purpose === 'conversation') {
      if (!request.sessionKey || !await this.options.sessionExists(request.sessionKey)) {
        throw new VoiceSessionCreationError('SESSION_NOT_FOUND', 'Conversation session was not found', 404);
      }
      if (this.options.sessionBusy(request.sessionKey)) {
        throw new VoiceSessionCreationError('SESSION_CONFLICT', 'Conversation session already has an active response', 409);
      }
      if (this.conversationReservations.has(request.sessionKey)) {
        throw new VoiceSessionCreationError('SESSION_CONFLICT', 'Conversation session already has a voice connection', 409);
      }
      if (!tts) {
        throw new VoiceSessionCreationError(
          'PROVIDER_UNAVAILABLE',
          'No configured PCM streaming text-to-speech provider is available',
          503,
        );
      }
    }
    if (this.tickets.size >= MAX_OUTSTANDING_TICKETS) {
      throw new VoiceSessionCreationError('SESSION_LIMIT', 'Too many outstanding realtime voice tickets', 429);
    }

    const sessionId = crypto.randomUUID();
    const ticket = crypto.randomBytes(32).toString('base64url');
    const maxSessionMs = request.purpose === 'conversation'
      ? config.voice.realtime.maxConversationMs
      : config.voice.realtime.maxDictationMs;
    const claim: VoiceTicketClaim = {
      sessionId,
      principalId,
      request,
      inputMode,
      idleTimeoutMs: config.voice.realtime.idleTimeoutMs,
      maxSessionMs,
      silenceDurationMs: config.voice.realtime.silenceDurationMs,
      stt,
      ...(tts ? { tts } : {}),
      config,
      createdAt: now,
      expiresAt: now + TICKET_TTL_MS,
    };
    this.tickets.set(ticketKey(ticket), claim);
    if (request.purpose === 'conversation' && request.sessionKey) {
      this.conversationReservations.set(request.sessionKey, sessionId);
    }
    return {
      sessionId,
      ticket,
      ticketExpiresAt: new Date(claim.expiresAt).toISOString(),
      websocketPath: VOICE_REALTIME_WS_PATH,
      protocolVersion: VOICE_REALTIME_PROTOCOL_VERSION,
      purpose: request.purpose,
      inputMode,
      bargeIn: config.voice.realtime.bargeIn,
      inputFormat: { encoding: 'pcm_s16le', sampleRate: 16_000, channels: 1 },
      limits: {
        maxBinaryFrameBytes: VOICE_REALTIME_MAX_BINARY_FRAME_BYTES,
        maxSessionMs,
        idleTimeoutMs: claim.idleTimeoutMs,
      },
      route: { stt: stt.route, ...(tts ? { tts: tts.route } : {}) },
    };
  }

  handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): boolean {
    const pathname = new URL(req.url ?? '/', 'http://gateway.local').pathname;
    if (pathname !== VOICE_REALTIME_WS_PATH) return false;
    if (this.closed || this.wss.clients.size >= MAX_CONNECTIONS) {
      socket.destroy();
      return true;
    }
    const clientIp = req.socket.remoteAddress;
    if (!this.preauthBudget.acquire(clientIp)) {
      socket.destroy();
      return true;
    }
    try {
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
    } catch (error) {
      this.preauthBudget.release(clientIp);
      throw error;
    }
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const client of this.wss.clients) client.close(1001, 'Gateway stopping');
    this.tickets.clear();
    this.wss.close();
    this.socketsByPrincipal.clear();
    this.conversationReservations.clear();
  }

  private releaseConversationReservation(claim: VoiceTicketClaim): void {
    const sessionKey = claim.request.sessionKey;
    if (sessionKey && this.conversationReservations.get(sessionKey) === claim.sessionId) {
      this.conversationReservations.delete(sessionKey);
    }
  }

  private consumeTicket(ticket: string, sessionId: string, now = Date.now()): VoiceTicketClaim | undefined {
    const key = ticketKey(ticket);
    const claim = this.tickets.get(key);
    this.tickets.delete(key);
    if (!claim) return undefined;
    if (claim.expiresAt < now || claim.sessionId !== sessionId) {
      this.releaseConversationReservation(claim);
      return undefined;
    }
    return claim;
  }

  private pruneTickets(now: number): void {
    for (const [key, claim] of this.tickets) {
      if (claim.expiresAt < now) {
        this.tickets.delete(key);
        this.releaseConversationReservation(claim);
      }
    }
  }

  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const runtimeOptions = this.options;
    const clientIp = request.socket.remoteAddress;
    let claim: VoiceTicketClaim | undefined;
    let sttSession: StreamingSttSession | undefined;
    let ready = false;
    let committing = false;
    let seq = 0;
    let finalCount = 0;
    let finalCountAtLastCommit = 0;
    let closed = false;
    let activeResponse: ActiveVoiceResponse | undefined;
    let conversationTail = Promise.resolve();
    let lastActivityAt = Date.now();
    const abortController = new AbortController();
    const seenMessageIds = new Set<string>();

    const send = <T extends VoiceServerEvent['type']>(
      type: T,
      payload: Extract<VoiceServerEvent, { type: T }>['payload'],
    ) => {
      if (!claim || socket.readyState !== WebSocketState.OPEN) return;
      const event = {
        protocolVersion: VOICE_REALTIME_PROTOCOL_VERSION,
        eventId: crypto.randomUUID(),
        seq: ++seq,
        type,
        sentAt: Date.now(),
        sessionId: claim.sessionId,
        payload,
      } as Extract<VoiceServerEvent, { type: T }>;
      socket.send(JSON.stringify(event));
    };

    const detachPrincipal = () => {
      if (!claim) return;
      const sockets = this.socketsByPrincipal.get(claim.principalId);
      sockets?.delete(socket);
      if (sockets?.size === 0) this.socketsByPrincipal.delete(claim.principalId);
    };
    const shutdown = async (reason: string, notify: boolean) => {
      if (closed) return;
      closed = true;
      clearTimeout(startTimer);
      clearInterval(lifecycleTimer);
      cancelActiveResponse('session_closed');
      abortController.abort(reason);
      sttSession?.abort(reason);
      if (notify) send('session.closed', { reason });
      detachPrincipal();
      if (claim) this.releaseConversationReservation(claim);
      this.preauthBudget.release(clientIp);
      if (socket.readyState === WebSocketState.OPEN) socket.close(1000, reason.slice(0, 120));
    };

    function cancelActiveResponse(reason: 'barge_in' | 'client_cancelled' | 'session_closed'): boolean {
      const response = activeResponse;
      if (!response) return false;
      activeResponse = undefined;
      response.abortController.abort(reason);
      send('response.cancelled', { responseId: response.id, reason });
      const sessionKey = claim?.request.sessionKey;
      if (sessionKey && reason !== 'session_closed') {
        void runtimeOptions.recordInterruption({
          sessionKey,
          responseId: response.id,
          reason,
          generatedCharacters: response.text.length,
          interruptedDuring: response.audioStarted ? 'speaking' : 'thinking',
        }).catch((error) => {
          log.warn({ err: error, sessionId: claim?.sessionId, responseId: response.id }, 'Voice interruption audit failed');
        });
      }
      return true;
    }

    async function speakPhrase(response: ActiveVoiceResponse, phrase: string): Promise<void> {
      if (!claim?.tts || response.abortController.signal.aborted) return;
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
          if (socket.bufferedAmount > 1024 * 1024) throw new Error('Voice client audio backpressure limit exceeded');
          if (socket.readyState !== WebSocketState.OPEN) return;
          // Half-second frames keep acknowledgements flowing within the playback window.
          for (let offset = 0; offset < item.value.byteLength; offset += 24_000) {
            const chunk = item.value.subarray(offset, offset + 24_000);
            await response.playback.reserve(chunk.byteLength, response.abortController.signal);
            if (activeResponse !== response || socket.readyState !== WebSocketState.OPEN) return;
            socket.send(chunk, { binary: true });
          }
        }
      } finally {
        await result.release();
      }
    }

    function queuePhrases(response: ActiveVoiceResponse, phrases: string[]): void {
      for (const phrase of phrases) {
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
          });
      }
    }

    async function runConversationTurn(text: string): Promise<void> {
      if (!claim?.tts || !claim.request.sessionKey || !text.trim() || closed) return;
      cancelActiveResponse('barge_in');
      const response: ActiveVoiceResponse = {
        id: `resp_${crypto.randomUUID()}`,
        playback: new AudioPlaybackWindow(),
        abortController: new AbortController(),
        segmenter: new SpeakableSegmenter(),
        text: '',
        audioStarted: false,
        speechTail: Promise.resolve(),
        startedAt: Date.now(),
        firstTextSeen: false,
      };
      activeResponse = response;
      send('response.created', { responseId: response.id });
      try {
        for await (const event of runtimeOptions.runAgent(
          text,
          claim.request.sessionKey,
          response.abortController.signal,
        )) {
          if (activeResponse !== response || response.abortController.signal.aborted) return;
          if (event.type === 'assistant_delta' && typeof event.payload?.delta === 'string') {
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
      return consumed.stt.plugin.openAudioStream({
        model: consumed.stt.model,
        inputFormat: { encoding: 'pcm_s16le', sampleRate: 16_000, channels: 1 },
        ...(consumed.stt.apiKey ? { apiKey: consumed.stt.apiKey } : {}),
        ...(consumed.stt.baseUrl ? { baseUrl: consumed.stt.baseUrl } : {}),
        ...(consumed.stt.headers ? { headers: consumed.stt.headers } : {}),
        ...(consumed.stt.language ? { language: consumed.stt.language } : {}),
        ...(consumed.stt.prompt ? { prompt: consumed.stt.prompt } : {}),
        turnDetection: {
          mode: consumed.inputMode,
          silenceDurationMs: consumed.silenceDurationMs,
        },
        timeoutMs: 15_000,
        signal: abortController.signal,
        onEvent: onSttEvent,
      });
    }

    function onSttEvent(event: StreamingSttEvent): void {
      if (closed || !claim) return;
      if (event.type === 'ready' || event.type === 'usage') return;
      if (event.type === 'error') {
        log.warn({ err: event.error, sessionId: claim.sessionId, provider: claim.stt.route.provider }, 'Realtime STT failed');
        send('session.error', { code: 'PROVIDER_ERROR', message: 'Streaming transcription failed', recoverable: false });
        void shutdown('provider_error', true);
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
        finalCount += 1;
        send('input.transcript.final', {
          utteranceId: event.utteranceId,
          revision: event.revision,
          text,
          ...(event.language === 'zh' || event.language === 'en' ? { language: event.language } : {}),
        });
        if (claim.request.purpose === 'conversation') {
          conversationTail = conversationTail.then(() => runConversationTurn(text));
        }
      }
    }

    const startTimer = setTimeout(() => socket.close(4401, 'Voice session start timeout'), VOICE_REALTIME_START_TIMEOUT_MS);
    const lifecycleTimer = setInterval(() => {
      if (!claim) return;
      const now = Date.now();
      if (now - lastActivityAt > claim.idleTimeoutMs) void shutdown('idle_timeout', true);
      else if (now - claim.createdAt > claim.maxSessionMs) void shutdown('session_limit', true);
    }, 1_000);

    const authenticate = async (message: Extract<VoiceClientMessage, { type: 'session.start' }>) => {
      const consumed = this.consumeTicket(message.payload.ticket, message.payload.sessionId);
      if (!consumed) {
        socket.close(4401, 'Invalid voice session ticket');
        return;
      }
      const principalSockets = this.socketsByPrincipal.get(consumed.principalId) ?? new Set<WebSocket>();
      if (principalSockets.size >= MAX_CONNECTIONS_PER_PRINCIPAL) {
        this.releaseConversationReservation(consumed);
        socket.close(4429, 'Voice session concurrency limit');
        return;
      }
      claim = consumed;
      principalSockets.add(socket);
      this.socketsByPrincipal.set(consumed.principalId, principalSockets);
      clearTimeout(startTimer);
      try {
        sttSession = await openSttSession(consumed);
        ready = true;
        log.info({
          sessionId: consumed.sessionId,
          purpose: consumed.request.purpose,
          provider: consumed.stt.route.provider,
          model: consumed.stt.route.model,
          latencyMs: Date.now() - consumed.createdAt,
        }, 'Realtime voice session ready');
        send('session.ready', {
          purpose: consumed.request.purpose,
          inputMode: consumed.inputMode,
          inputFormat: { encoding: 'pcm_s16le', sampleRate: 16_000, channels: 1 },
          route: { stt: consumed.stt.route, ...(consumed.tts ? { tts: consumed.tts.route } : {}) },
          heartbeatIntervalMs: VOICE_REALTIME_HEARTBEAT_INTERVAL_MS,
        });
      } catch (error) {
        log.warn({ err: error, sessionId: consumed.sessionId, provider: consumed.stt.route.provider }, 'Realtime STT setup failed');
        send('session.error', { code: 'PROVIDER_UNAVAILABLE', message: 'Streaming transcription is unavailable', recoverable: false });
        await shutdown('provider_unavailable', true);
      }
    };

    socket.on('message', (data, isBinary) => {
      lastActivityAt = Date.now();
      if (isBinary) {
        if (!claim) {
          socket.close(4401, 'Voice session is not ready');
          return;
        }
        const bytes = data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : Array.isArray(data)
            ? Buffer.concat(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        if (bytes.byteLength === 0 || bytes.byteLength % 2 !== 0 || bytes.byteLength > VOICE_REALTIME_MAX_BINARY_FRAME_BYTES) {
          send('session.error', { code: 'INVALID_AUDIO', message: 'Invalid PCM audio frame', recoverable: false });
          void shutdown('invalid_audio', true);
          return;
        }
        if (!ready || !sttSession) {
          socket.close(4401, 'Voice session is not ready');
          return;
        }
        try {
          sttSession.appendAudio(bytes);
        } catch (error) {
          log.warn({ err: error, sessionId: claim.sessionId }, 'Realtime STT rejected audio');
          send('session.error', { code: 'AUDIO_BACKPRESSURE', message: 'Audio stream cannot keep up', recoverable: false });
          void shutdown('audio_backpressure', true);
        }
        return;
      }

      let message: VoiceClientMessage;
      try {
        message = parseVoiceClientMessage(parseVoiceClientJsonFrame(rawText(data)));
        if (Math.abs(Date.now() - message.sentAt) > MAX_CLOCK_SKEW_MS) throw new Error('Clock skew');
        if (seenMessageIds.has(message.messageId)) return;
        if (seenMessageIds.size >= 256) seenMessageIds.clear();
        seenMessageIds.add(message.messageId);
      } catch (error) {
        log.debug({ err: error }, 'Voice client sent an invalid control frame');
        socket.close(4400, 'Invalid voice protocol frame');
        return;
      }

      if (!claim) {
        if (message.type !== 'session.start') {
          socket.close(4401, 'First voice message must be session.start');
          return;
        }
        void authenticate(message);
        return;
      }
      if (message.type === 'session.ping') {
        send('session.pong', {});
      } else if (message.type === 'session.stop') {
        void shutdown(message.payload.reason, true);
      } else if (message.type === 'response.cancel') {
        if (!activeResponse || activeResponse.id !== message.payload.responseId) {
          send('session.error', { code: 'NO_ACTIVE_RESPONSE', message: 'No matching response is active', recoverable: true });
        } else {
          cancelActiveResponse('client_cancelled');
        }
      } else if (message.type === 'response.audio.played') {
        if (activeResponse?.id === message.payload.responseId) {
          try {
            activeResponse.playback.acknowledge(message.payload.playedBytes);
          } catch {
            socket.close(4400, 'Invalid playback acknowledgement');
          }
        }
      } else if (message.type === 'input.commit') {
        if (claim.request.purpose !== 'dictation') {
          send('session.error', { code: 'INVALID_STATE', message: 'Conversation input uses server turn detection', recoverable: true });
          return;
        }
        if (!ready || !sttSession || committing) {
          send('session.error', { code: 'INVALID_STATE', message: 'Input is already being committed', recoverable: true });
          return;
        }
        const finalCountBeforeCommit = finalCount;
        const alreadyFinalized = finalCountBeforeCommit > finalCountAtLastCommit;
        const committingSession = sttSession;
        ready = false;
        committing = true;
        void committingSession.commit().then(async () => {
          if (!alreadyFinalized && finalCount === finalCountBeforeCommit) {
            send('session.error', { code: 'EMPTY_UTTERANCE', message: 'No speech was recognized', recoverable: true });
          }
          finalCountAtLastCommit = finalCount;
          await shutdown('input_committed', true);
        }).catch((error) => {
          committing = false;
          onSttEvent({ type: 'error', error: error instanceof Error ? error : new Error(String(error)) });
        });
      } else {
        send('session.error', { code: 'INVALID_STATE', message: 'Voice session is already started', recoverable: true });
      }
    });

    socket.once('close', () => void shutdown('disconnected', false));
    socket.once('error', (err) => log.debug({ err }, 'Voice client socket failed'));
  }
}
