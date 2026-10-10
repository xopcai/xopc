import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

import type { RawData } from 'ws';

import type { SpeechStreamSession, SpeechSynthesisStreamResult } from '../tts/speech-provider-types.js';
import { createLogger } from '../../utils/logger.js';

const { WebSocket } = createRequire(import.meta.url)('ws') as typeof import('ws');
const DEFAULT_REALTIME_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
const DEFAULT_REALTIME_VOLUME = 100;
const log = createLogger('TTS:DashScope');

class TtsHandshakeError extends Error {
  constructor(readonly statusCode: number, readonly retryAfterMs: number | undefined) {
    super(`Realtime TTS WebSocket handshake failed (HTTP ${statusCode})${retryAfterMs === undefined ? '' : `; retry after ${retryAfterMs} ms`}`);
    this.name = 'TtsHandshakeError';
  }
}

function parseRetryAfter(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

interface DashScopeTtsMessage {
  type?: string;
  delta?: unknown;
  error?: { code?: unknown; message?: unknown };
}

export interface DashScopeStreamingTtsRequest {
  apiKey: string;
  baseUrl?: string;
  model: string;
  voice: string;
  volume?: number;
  text: string;
  instructions?: string;
  signal: AbortSignal;
  timeoutMs: number;
}

function realtimeUrl(baseUrl: string | undefined, model: string): string {
  const configured = baseUrl ? new URL(baseUrl) : new URL(DEFAULT_REALTIME_URL);
  const wasWebSocket = configured.protocol === 'ws:' || configured.protocol === 'wss:';
  configured.protocol = configured.protocol === 'http:'
    ? 'ws:'
    : configured.protocol === 'https:'
      ? 'wss:'
      : configured.protocol;
  if (configured.protocol !== 'ws:' && configured.protocol !== 'wss:') {
    throw new Error('DashScope realtime TTS base URL must use HTTP or WebSocket');
  }
  if (!wasWebSocket) configured.pathname = '/api-ws/v1/realtime';
  configured.searchParams.set('model', model);
  return configured.toString();
}

function rawText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return data.toString('utf8');
}

function event(type: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ event_id: crypto.randomUUID(), type, ...extra });
}

export async function openDashScopeStreamingTts(
  request: DashScopeStreamingTtsRequest,
): Promise<SpeechSynthesisStreamResult> {
  const session = await openDashScopeTtsSession(request);
  try {
    const result = await session.synthesize(request.text);
    // Standalone synthesis does not keep the provider connection alive.
    return { ...result, release: () => session.close() };
  } catch (error) {
    await session.close();
    throw error;
  }
}

export async function openDashScopeTtsSession(
  request: Omit<DashScopeStreamingTtsRequest, 'text'>,
): Promise<SpeechStreamSession> {
  const volume = request.volume ?? DEFAULT_REALTIME_VOLUME;
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
    throw new Error('DashScope realtime TTS volume must be an integer from 0 to 100');
  }
  request = { ...request, volume };
  const deadline = Date.now() + request.timeoutMs;
  for (let attempt = 1; ; attempt += 1) {
    request.signal.throwIfAborted();
    try {
      return await openStreamingTtsAttempt({ ...request, timeoutMs: Math.max(1, deadline - Date.now()) });
    } catch (error) {
      if (request.signal.aborted) throw error;
      // Only rejected handshakes are safe to replay: no text has been sent yet.
      if (!(error instanceof TtsHandshakeError) || error.statusCode !== 429 || attempt >= 3) throw error;
      const delayMs = Math.max(error.retryAfterMs ?? 0, 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
      if (delayMs > 5_000 || Date.now() + delayMs >= deadline) throw error;
      log.warn({ model: request.model, statusCode: error.statusCode, attempt, delayMs }, 'Realtime TTS handshake rate limited; retrying');
      await delay(delayMs, undefined, { signal: request.signal });
      if (Date.now() >= deadline) throw error;
    }
  }
}

async function openStreamingTtsAttempt(
  request: Omit<DashScopeStreamingTtsRequest, 'text'>,
): Promise<SpeechStreamSession> {
  if (!request.apiKey) throw new Error('DashScope TTS API key is unavailable');
  request.signal.throwIfAborted();
  const startedAt = Date.now();
  const socket = new WebSocket(realtimeUrl(request.baseUrl, request.model), {
    headers: { Authorization: `Bearer ${request.apiKey}` },
    perMessageDeflate: false,
  });
  let settled = false;
  let closed = false;
  let failure: Error | undefined;
  let active: { controller: ReadableStreamDefaultController<Uint8Array>; audioDone: boolean;
    done: Promise<void>; resolve: () => void; reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>; submittedAt: number; firstAudio: boolean } | undefined;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const closeSocket = (code: number, reason: string) => {
    request.signal.removeEventListener('abort', onAbort);
    if (socket.readyState === WebSocket.OPEN) socket.close(code, reason);
    else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
  };
  const fail = (error: Error, code = 1011) => {
    if (closed) return;
    failure = error;
    closed = true;
    if (!settled) rejectReady(error);
    if (active) {
      clearTimeout(active.timer);
      if (!active.audioDone) active.controller.error(error);
      active.reject(error);
    }
    closeSocket(code, code === 1000 ? 'Aborted' : 'Provider stream failed');
  };
  const onAbort = () => fail(request.signal.reason instanceof Error ? request.signal.reason
    : new DOMException('Realtime TTS aborted', 'AbortError'), 1000);
  request.signal.addEventListener('abort', onAbort, { once: true });
  if (request.signal.aborted) onAbort();
  socket.on('unexpected-response', (_request, response) => {
    fail(new TtsHandshakeError(response.statusCode ?? 0, parseRetryAfter(response.headers['retry-after'])));
    response.destroy();
  });
  socket.on('message', (data, isBinary) => {
    if (closed || isBinary) return;
    let message: DashScopeTtsMessage;
    try { message = JSON.parse(rawText(data)) as DashScopeTtsMessage; }
    catch { fail(new Error('DashScope realtime TTS returned invalid JSON')); return; }
    if (message.type === 'session.created') {
      socket.send(event('session.update', { session: {
        voice: request.voice, mode: 'commit', language_type: 'Auto', response_format: 'pcm',
        sample_rate: 24_000, volume: request.volume,
        ...(request.instructions ? { instructions: request.instructions, optimize_instructions: false } : {}),
      } }));
    } else if (message.type === 'session.updated' && !settled) {
      settled = true;
      log.info({ model: request.model, phase: 'tts_connection_ready', setupMs: Date.now() - startedAt }, 'Realtime TTS connection ready');
      resolveReady();
    } else if (message.type === 'response.audio.delta' && active && !active.audioDone) {
      if (typeof message.delta !== 'string') { fail(new Error('DashScope realtime TTS returned invalid audio')); return; }
      const bytes = Buffer.from(message.delta, 'base64');
      if (!bytes.byteLength) return;
      if (!active.firstAudio) {
        active.firstAudio = true;
        log.info({ model: request.model, phase: 'tts_first_audio', synthesisMs: Date.now() - active.submittedAt }, 'Realtime TTS first audio received');
      }
      active.controller.enqueue(bytes);
    } else if (message.type === 'response.audio.done' && active && !active.audioDone) {
      active.audioDone = true;
      active.controller.close();
    } else if (message.type === 'response.done' && active) {
      if (!active.audioDone) { active.audioDone = true; active.controller.close(); }
      clearTimeout(active.timer);
      active.resolve();
      active = undefined;
    } else if (message.type === 'error') {
      const code = typeof message.error?.code === 'string' ? message.error.code : undefined;
      const detail = typeof message.error?.message === 'string' ? message.error.message : undefined;
      fail(new Error([code, detail].filter(Boolean).join(': ') || 'DashScope realtime TTS failed'));
    }
  });
  socket.on('error', error => fail(error));
  socket.on('close', () => {
    request.signal.removeEventListener('abort', onAbort);
    if (!closed) fail(new Error('DashScope realtime TTS connection closed unexpectedly'));
  });
  const timeout = setTimeout(() => fail(new Error('DashScope realtime TTS setup timed out')), request.timeoutMs);
  try { await ready; } finally { clearTimeout(timeout); }
  return {
    async synthesize(text) {
      request.signal.throwIfAborted();
      if (closed) throw failure ?? new Error('Realtime TTS session closed');
      if (active) throw new Error('Realtime TTS synthesis already active');
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const done = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      // A connection can fail while the consumer is still reading audio.
      void done.catch(() => {});
      const audioStream = new ReadableStream<Uint8Array>({
        start(controller) {
          active = { controller, audioDone: false, done, resolve, reject,
            submittedAt: Date.now(), firstAudio: false,
            timer: setTimeout(() => fail(new Error('Realtime TTS synthesis timed out')), request.timeoutMs) };
        },
        cancel() { fail(new DOMException('Realtime TTS consumer cancelled', 'AbortError'), 1000); },
      });
      socket.send(event('input_text_buffer.append', { text }));
      socket.send(event('input_text_buffer.commit'));
      return { audioStream, outputFormat: 'pcm', fileExtension: 'pcm', voiceCompatible: false,
        // Wait for the response boundary before allowing the next commit.
        release: async () => { await done; } };
    },
    async close() {
      if (closed) return;
      if (active && !active.audioDone) {
        fail(new DOMException('Realtime TTS session released', 'AbortError'), 1000);
        return;
      }
      if (active) {
        clearTimeout(active.timer);
        active.resolve();
        active = undefined;
      }
      closed = true;
      if (socket.readyState === WebSocket.OPEN) socket.send(event('session.finish'));
      closeSocket(1000, 'Released');
    },
  };
}
