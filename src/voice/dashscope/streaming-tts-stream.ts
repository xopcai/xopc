import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

import type { RawData } from 'ws';

import type { SpeechSynthesisStreamResult } from '../tts/speech-provider-types.js';
import { createLogger } from '../../utils/logger.js';

const { WebSocket } = createRequire(import.meta.url)('ws') as typeof import('ws');
const DEFAULT_REALTIME_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
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
  request: DashScopeStreamingTtsRequest,
): Promise<SpeechSynthesisStreamResult> {
  if (!request.apiKey) throw new Error('DashScope TTS API key is unavailable');
  if (request.signal.aborted) throw request.signal.reason;

  const socket = new WebSocket(realtimeUrl(request.baseUrl, request.model), {
    headers: { Authorization: `Bearer ${request.apiKey}` },
    perMessageDeflate: false,
  });
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let settled = false;
  let streamClosed = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const audioStream = new ReadableStream<Uint8Array>({
    start(next) {
      controller = next;
    },
    cancel() {
      streamClosed = true;
      socket.close(1000, 'Consumer cancelled');
    },
  });

  const fail = (error: Error, closeSocket = true) => {
    if (!settled) rejectReady(error);
    if (!streamClosed) {
      streamClosed = true;
      controller?.error(error);
    }
    if (closeSocket) {
      if (socket.readyState === WebSocket.OPEN) socket.close(1011, 'Provider stream failed');
      else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    }
  };
  const finishStream = () => {
    if (streamClosed) return;
    streamClosed = true;
    controller?.close();
  };
  const onAbort = () => {
    const error = request.signal.reason instanceof Error
      ? request.signal.reason
      : new DOMException('Realtime TTS aborted', 'AbortError');
    fail(error, false);
    if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'Aborted');
    else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
  };
  request.signal.addEventListener('abort', onAbort, { once: true });

  socket.on('unexpected-response', (_request, response) => {
    const error = new TtsHandshakeError(response.statusCode ?? 0, parseRetryAfter(response.headers['retry-after']));
    fail(error);
    response.destroy();
  });
  socket.on('message', (data, isBinary) => {
    if (streamClosed || request.signal.aborted) return;
    if (isBinary) return;
    let message: DashScopeTtsMessage;
    try {
      message = JSON.parse(rawText(data)) as DashScopeTtsMessage;
    } catch {
      fail(new Error('DashScope realtime TTS returned invalid JSON'));
      return;
    }
    if (message.type === 'session.created') {
      socket.send(event('session.update', {
        session: {
          voice: request.voice,
          mode: 'commit',
          language_type: 'Auto',
          response_format: 'pcm',
          sample_rate: 24_000,
          ...(request.instructions
            ? { instructions: request.instructions, optimize_instructions: false }
            : {}),
        },
      }));
      return;
    }
    if (message.type === 'session.updated') {
      settled = true;
      resolveReady();
      socket.send(event('input_text_buffer.append', { text: request.text }));
      socket.send(event('input_text_buffer.commit'));
      return;
    }
    if (message.type === 'response.audio.delta') {
      if (streamClosed) return;
      if (typeof message.delta !== 'string') {
        fail(new Error('DashScope realtime TTS returned invalid audio'));
        return;
      }
      controller?.enqueue(Buffer.from(message.delta, 'base64'));
      return;
    }
    if (message.type === 'response.audio.done') {
      finishStream();
      socket.send(event('session.finish'));
      return;
    }
    if (message.type === 'error') {
      const code = typeof message.error?.code === 'string' ? message.error.code : undefined;
      const detail = typeof message.error?.message === 'string' ? message.error.message : undefined;
      fail(new Error([code, detail].filter(Boolean).join(': ') || 'DashScope realtime TTS failed'));
    }
  });
  socket.on('error', (error) => fail(error));
  socket.on('close', () => {
    request.signal.removeEventListener('abort', onAbort);
    if (!streamClosed) fail(new Error('DashScope realtime TTS connection closed unexpectedly'));
  });

  const timeout = setTimeout(() => {
    fail(new Error('DashScope realtime TTS setup timed out'));
    socket.close(1011, 'Setup timeout');
  }, request.timeoutMs);
  try {
    await readyPromise;
  } finally {
    clearTimeout(timeout);
  }

  return {
    audioStream,
    outputFormat: 'pcm',
    fileExtension: 'pcm',
    voiceCompatible: false,
    release: async () => {
      request.signal.removeEventListener('abort', onAbort);
      finishStream();
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'Released');
    },
  };
}
