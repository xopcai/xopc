import crypto from 'node:crypto';
import { createRequire } from 'node:module';

import type { RawData } from 'ws';

import type {
  StreamingSttOpenRequest,
  StreamingSttSession,
} from '../../media-understanding/types.js';

const { WebSocket: NodeWebSocket } = createRequire(import.meta.url)('ws') as typeof import('ws');

const DEFAULT_REALTIME_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
const MAX_BUFFERED_AUDIO_BYTES = 512 * 1024;

interface DashScopeHeader {
  event?: string;
  error_code?: string;
  error_message?: string;
}

interface DashScopeMessage {
  header?: DashScopeHeader;
  payload?: {
    output?: {
          sentence?: {
            text?: unknown;
            sentence_begin?: unknown;
            sentence_end?: unknown;
            heartbeat?: unknown;
          };
    };
    usage?: { duration?: unknown };
  };
}

function realtimeUrl(baseUrl?: string): string {
  if (!baseUrl) return DEFAULT_REALTIME_URL;
  const url = new URL(baseUrl);
  const wasWebSocket = url.protocol === 'ws:' || url.protocol === 'wss:';
  url.protocol = url.protocol === 'http:' ? 'ws:' : url.protocol === 'https:' ? 'wss:' : url.protocol;
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('DashScope realtime base URL must use HTTP or WebSocket');
  }
  if (!wasWebSocket && !url.pathname.includes('/api-ws/')) {
    url.pathname = '/api-ws/v1/inference';
    url.search = '';
  }
  return url.toString();
}

function rawText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return data.toString('utf8');
}

function providerError(message: DashScopeMessage): Error {
  const code = message.header?.error_code;
  const detail = message.header?.error_message;
  return new Error([code, detail].filter(Boolean).join(': ') || 'DashScope realtime STT failed');
}

export async function openDashScopeStreamingStt(
  request: StreamingSttOpenRequest,
): Promise<StreamingSttSession> {
  if (!request.apiKey) throw new Error('DashScope STT API key is unavailable');
  if (request.signal.aborted) {
    throw request.signal.reason instanceof Error
      ? request.signal.reason
      : new Error('DashScope realtime STT aborted');
  }
  if (request.inputFormat.encoding !== 'pcm_s16le' || request.inputFormat.channels !== 1) {
    throw new Error('DashScope realtime STT requires mono PCM16 audio');
  }

  const taskId = crypto.randomUUID();
  const socket = new NodeWebSocket(realtimeUrl(request.baseUrl), {
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      ...request.headers,
    },
    perMessageDeflate: false,
  });
  let ready = false;
  let finished = false;
  let closing = false;
  let currentUtteranceId: string | undefined;
  let revision = 0;
  let inputBytes = 0;
  let failed = false;

  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let resolveFinished!: () => void;
  const finishedPromise = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  const fail = (error: Error) => {
    if (failed) return;
    failed = true;
    if (!ready) rejectReady(error);
    request.onEvent({ type: 'error', error });
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    resolveFinished();
  };
  const closeSocket = (reason: string) => {
    closing = true;
    if (socket.readyState === NodeWebSocket.OPEN) socket.close(1000, reason.slice(0, 120));
    else if (socket.readyState === NodeWebSocket.CONNECTING) socket.terminate();
  };

  socket.on('open', () => {
    socket.send(JSON.stringify({
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: request.model,
        parameters: {
          format: 'pcm',
          sample_rate: request.inputFormat.sampleRate,
          semantic_punctuation_enabled: false,
          max_sentence_silence: request.turnDetection.silenceDurationMs,
          ...(request.language && request.language !== 'auto'
            ? { language_hints: [request.language] }
            : {}),
        },
        input: request.prompt
          ? {
              context: [{
                role: 'user',
                content: [{ type: 'input_text', text: request.prompt.slice(0, 400) }],
              }],
            }
          : {},
      },
    }));
  });

  socket.on('message', (data, isBinary) => {
    if (isBinary) return;
    let message: DashScopeMessage;
    try {
      message = JSON.parse(rawText(data)) as DashScopeMessage;
    } catch {
      fail(new Error('DashScope realtime STT returned invalid JSON'));
      finish();
      closeSocket('Invalid provider response');
      return;
    }
    const event = message.header?.event;
    if (event === 'task-started') {
      ready = true;
      resolveReady();
      request.onEvent({ type: 'ready' });
      return;
    }
    if (event === 'task-failed') {
      fail(providerError(message));
      finish();
      closeSocket('Provider task failed');
      return;
    }
    if (event === 'task-finished') {
      const duration = Number(message.payload?.usage?.duration);
      const inputAudioMs = Number.isFinite(duration)
        ? Math.max(0, Math.round(duration))
        : Math.round((inputBytes / 2 / request.inputFormat.sampleRate) * 1_000);
      request.onEvent({ type: 'usage', inputAudioMs });
      finish();
      closeSocket('Complete');
      return;
    }
    if (event !== 'result-generated') return;

    const sentence = message.payload?.output?.sentence;
    if (sentence?.heartbeat === true) return;
    const text = sentence?.text;
    if (typeof text !== 'string') return;
    if (sentence.sentence_begin === true) {
      currentUtteranceId = crypto.randomUUID();
      revision = 0;
      request.onEvent({ type: 'speech_started', utteranceId: currentUtteranceId });
    }
    if (!currentUtteranceId) return;
    revision += 1;
    if (sentence.sentence_end === true) {
      request.onEvent({ type: 'speech_stopped', utteranceId: currentUtteranceId });
      request.onEvent({
        type: 'transcript_final',
        utteranceId: currentUtteranceId,
        revision,
        text,
        ...(request.language ? { language: request.language } : {}),
      });
      currentUtteranceId = undefined;
      revision = 0;
    } else {
      request.onEvent({ type: 'transcript_delta', utteranceId: currentUtteranceId, revision, text });
    }
  });

  socket.on('error', (error) => {
    fail(error);
    finish();
    closeSocket('Provider socket failed');
  });
  socket.on('close', () => {
    request.signal.removeEventListener('abort', onAbort);
    if (!closing && !finished) fail(new Error('DashScope realtime STT connection closed unexpectedly'));
    finish();
  });

  const onAbort = () => {
    if (!ready) {
      rejectReady(request.signal.reason instanceof Error
        ? request.signal.reason
        : new Error('DashScope realtime STT aborted'));
    }
    finish();
    closeSocket('Aborted');
  };
  request.signal.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => {
    fail(new Error('DashScope realtime STT setup timed out'));
    finish();
    closeSocket('Setup timeout');
  }, request.timeoutMs);
  try {
    await readyPromise;
  } finally {
    clearTimeout(timeout);
  }

  return {
    appendAudio(chunk) {
      if (!ready || closing || finished || socket.readyState !== NodeWebSocket.OPEN) {
        throw new Error('DashScope realtime STT is not writable');
      }
      if (socket.bufferedAmount + chunk.byteLength > MAX_BUFFERED_AUDIO_BYTES) {
        throw new Error('DashScope realtime STT audio backpressure limit exceeded');
      }
      inputBytes += chunk.byteLength;
      socket.send(chunk, { binary: true });
    },
    async commit() {
      if (!closing && !finished) {
        closing = true;
        socket.send(JSON.stringify({
          header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
          payload: { input: {} },
        }));
      }
      await finishedPromise;
      closeSocket('Complete');
    },
    async close() {
      if (!closing && !finished) {
        closing = true;
        socket.send(JSON.stringify({
          header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
          payload: { input: {} },
        }));
      }
      await finishedPromise;
      request.signal.removeEventListener('abort', onAbort);
      closeSocket('Complete');
    },
    abort(reason) {
      finish();
      closeSocket(reason);
    },
  };
}
