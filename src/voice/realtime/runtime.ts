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
  encodeVoiceAudioFrame,
  type CreateVoiceSessionRequest,
  type CreateVoiceSessionResponse,
  type VoiceClientMessage,
  type VoiceProviderRoute,
} from '@xopcai/realtime-protocol/voice';
import type { RawData, WebSocket } from 'ws';

import type { Config } from '../../config/schema.js';
import { getMediaUnderstandingProvider } from '../../media-understanding/registry.js';
import type {
  MediaUnderstandingProvider,
} from '../../media-understanding/types.js';
import { createPreauthConnectionBudget } from '../../gateway/security/preauth-connection-budget.js';
import { createLogger } from '../../utils/logger.js';
import { mergeSttConfigFromAppConfig } from '../stt/config.js';
import { resolveSTTProviderChain } from '../stt/factory.js';
import { getModelCatalogStore } from '../../providers/model-catalog-store.js';
import { mergeTtsConfigFromAppConfig } from '../tts/merge-config.js';
import { resolveSpeechProviderChain, type ResolvedSpeechProvider } from '../tts/factory.js';
import type { TTSConfig } from '../tts/types.js';
import { ALIBABA_REALTIME_TTS_MODEL } from '../tts/providers/alibaba-speech.js';
import { createAgentVoiceEngine } from './agentEngine.js';
import type { VoiceEngine, VoiceEventSink } from './engine.js';
import { resolveOmniRoute, type OmniRoute } from './omniRoute.js';
import { createOmniVoiceEngine, type OmniTranscript } from './omniEngine.js';

const { WebSocket: WebSocketState, WebSocketServer } = createRequire(import.meta.url)('ws') as typeof import('ws');
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

export interface VoiceTicketClaim {
  sessionId: string;
  principalId: string;
  request: CreateVoiceSessionRequest;
  inputMode: 'server_vad';
  idleTimeoutMs: number;
  maxSessionMs: number;
  silenceDurationMs: number;
  stt?: ResolvedStreamingStt;
  omni?: OmniRoute;
  conversationSessionId?: string;
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

export interface VoiceRealtimeRuntimeOptions {
  recordOmniTranscript?: (sessionKey: string, callId: string, entry: OmniTranscript, expectedSessionId: string) => Promise<void>;
  getSessionIdentity?: (sessionKey: string) => Promise<string | undefined>;
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

export function resolveStreamingStt(config: Config, language?: string): ResolvedStreamingStt | undefined {
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

export function resolveStreamingTts(config: Config): ResolvedStreamingTts | undefined {
  let effective = mergeTtsConfigFromAppConfig(config.messages?.tts);
  const selection = config.voice?.realtime?.tts;
  if (selection) {
    const slice = effective.providers?.[selection.provider] ?? {};
    const input = config.tools?.media?.audio?.providers?.[selection.provider];
    const apiKey = input?.apiKey || (selection.provider === 'alibaba' ? process.env.DASHSCOPE_API_KEY : undefined) || slice.apiKey;
    effective = {
      ...effective,
      enabled: true,
      provider: selection.provider,
      managedAuto: false,
      fallback: { enabled: false, order: [] },
      providers: {
        [selection.provider]: {
          // Explicit conversation setup reuses the input credential on the server only.
          ...(apiKey ? { apiKey } : {}),
          ...(slice.baseUrl ? { baseUrl: slice.baseUrl } : {}),
          ...(selection.voice ? { voice: selection.voice } : selection.provider === 'alibaba' ? { voice: 'Cherry' } : {}),
        },
      },
    };
  }
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
    let omni: OmniRoute | undefined;
    if (request.engine === 'omni') {
      try { omni = await resolveOmniRoute(config); }
      catch { throw new VoiceSessionCreationError('PROVIDER_UNAVAILABLE', 'Natural conversation is unavailable. Check its model, endpoint and credentials.', 503); }
    }
    if (omni && !this.options.recordOmniTranscript) throw new VoiceSessionCreationError('PROVIDER_UNAVAILABLE', 'Natural conversation storage is unavailable', 503);
    const conversationSessionId = omni && request.sessionKey ? await this.options.getSessionIdentity?.(request.sessionKey) : undefined;
    if (omni && !conversationSessionId) throw new VoiceSessionCreationError('SESSION_NOT_FOUND', 'Conversation session was not found', 404);
    const stt = omni ? undefined : resolveStreamingStt(config, request.language);
    if (!omni && !stt) {
      throw new VoiceSessionCreationError(
        'PROVIDER_UNAVAILABLE',
        'No configured streaming speech-to-text provider is available',
        503,
      );
    }
    const inputMode = 'server_vad' as const;
    if (stt && !stt.plugin.streamingAudio.turnDetection.includes(inputMode)) {
      throw new VoiceSessionCreationError(
        'PROVIDER_UNAVAILABLE',
        `Streaming speech-to-text provider does not support ${inputMode}`,
        503,
      );
    }
    const tts = request.engine === 'agent' ? resolveStreamingTts(config) : undefined;
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
      if (!omni && !tts) {
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
      ? Math.min(config.voice.realtime.maxConversationMs, omni?.route.managed ? 30 * 60_000 : Number.MAX_SAFE_INTEGER)
      : config.voice.realtime.maxDictationMs;
    const claim: VoiceTicketClaim = {
      conversationSessionId,
      sessionId,
      principalId,
      request,
      inputMode,
      idleTimeoutMs: config.voice.realtime.idleTimeoutMs,
      maxSessionMs,
      silenceDurationMs: config.voice.realtime.silenceDurationMs,
      stt,
      omni,
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
      route: omni ? { engine: 'omni', omni: omni.route } : tts ? { engine: 'agent', stt: stt!.route, tts: tts.route } : { engine: 'dictation', stt: stt!.route },
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

  hasConversation(sessionKey: string): boolean {
    this.pruneTickets(Date.now());
    return this.conversationReservations.has(sessionKey);
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
    const clientIp = request.socket.remoteAddress;
    let claim: VoiceTicketClaim | undefined;
    let engine: VoiceEngine | undefined;
    let ready = false;
    let seq = 0;
    let audioSeq = 0;
    let closed = false;
    let lastActivityAt = Date.now();
    const abortController = new AbortController();
    const seenMessageIds = new Set<string>();

    const send: VoiceEventSink = (type, payload) => {
      if (!claim || socket.readyState !== WebSocketState.OPEN) return;
      const event = {
        protocolVersion: VOICE_REALTIME_PROTOCOL_VERSION,
        eventId: crypto.randomUUID(),
        seq: ++seq,
        type,
        sentAt: Date.now(),
        sessionId: claim.sessionId,
        payload,
      };
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
      engine?.close();
      abortController.abort(reason);
      if (notify) send('session.closed', { reason });
      detachPrincipal();
      if (claim) this.releaseConversationReservation(claim);
      this.preauthBudget.release(clientIp);
      if (socket.readyState === WebSocketState.OPEN) socket.close(1000, reason.slice(0, 120));
    };

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
        const sendAudio = (responseId: string, bytes: Uint8Array) => {
          if (socket.bufferedAmount > 1024 * 1024) throw new Error('Voice client audio backpressure limit exceeded');
          if (!closed && socket.readyState === WebSocketState.OPEN) socket.send(encodeVoiceAudioFrame({ responseId, seq: ++audioSeq, audio: bytes }), { binary: true });
        };
        engine = consumed.omni ? createOmniVoiceEngine({
          callId: consumed.sessionId,
          route: consumed.omni, silenceDurationMs: consumed.silenceDurationMs,
          bargeIn: consumed.config.voice?.realtime?.bargeIn ?? true, send, sendAudio,
          record: (entry) => this.options.recordOmniTranscript!(consumed.request.sessionKey!, consumed.sessionId, entry, consumed.conversationSessionId!),
          onClose: shutdown,
        }) : createAgentVoiceEngine({
          claim: consumed, runtime: this.options, signal: abortController.signal, send, sendAudio, onClose: shutdown,
        });
        await engine.start();
        if (closed) return;
        ready = true;
        log.info({
          sessionId: consumed.sessionId,
          purpose: consumed.request.purpose,
          provider: consumed.omni?.route.provider ?? consumed.stt?.route.provider,
          model: consumed.omni?.route.model ?? consumed.stt?.route.model,
          latencyMs: Date.now() - consumed.createdAt,
        }, 'Realtime voice session ready');
        send('session.ready', {
          purpose: consumed.request.purpose,
          inputMode: consumed.inputMode,
          inputFormat: { encoding: 'pcm_s16le', sampleRate: 16_000, channels: 1 },
          route: consumed.omni ? { engine: 'omni', omni: consumed.omni.route } : consumed.tts ? { engine: 'agent', stt: consumed.stt!.route, tts: consumed.tts.route } : { engine: 'dictation', stt: consumed.stt!.route },
          heartbeatIntervalMs: VOICE_REALTIME_HEARTBEAT_INTERVAL_MS,
        });
      } catch (error) {
        log.warn({ err: error, sessionId: consumed.sessionId, provider: consumed.omni?.route.provider ?? consumed.stt?.route.provider }, 'Realtime voice setup failed');
        send('session.error', { code: 'PROVIDER_UNAVAILABLE', message: 'Voice engine is unavailable', recoverable: false });
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
        if (!ready || !engine) {
          socket.close(4401, 'Voice session is not ready');
          return;
        }
        try {
          engine.appendAudio(bytes);
        } catch (error) {
          log.warn({ err: error, sessionId: claim.sessionId }, 'Realtime voice engine rejected audio');
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
        if (!engine?.cancel(message.payload.responseId, 'client_cancelled')) {
          send('session.error', { code: 'NO_ACTIVE_RESPONSE', message: 'No matching response is active', recoverable: true });
        }
      } else if (message.type === 'response.audio.played') {
        try { engine?.acknowledge(message.payload.responseId, message.payload.playedBytes); }
        catch { socket.close(4400, 'Invalid playback acknowledgement'); }
      } else if (message.type === 'input.commit') {
        if (!ready || !engine || claim.request.purpose !== 'dictation') {
          send('session.error', { code: 'INVALID_STATE', message: 'Input cannot be committed', recoverable: true });
          return;
        }
        ready = false;
        void engine.commit().catch(async (error) => {
          log.warn({ err: error, sessionId: claim?.sessionId }, 'Voice input commit failed');
          send('session.error', { code: 'PROVIDER_ERROR', message: 'Voice input commit failed', recoverable: false });
          await shutdown('provider_error', true);
        });
      } else {
        send('session.error', { code: 'INVALID_STATE', message: 'Voice session is already started', recoverable: true });
      }
    });

    socket.once('close', () => void shutdown('disconnected', false));
    socket.once('error', (err) => log.debug({ err }, 'Voice client socket failed'));
  }
}
