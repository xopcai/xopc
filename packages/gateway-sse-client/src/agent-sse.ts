/**
 * Client-side parser for xopc Chat Stream Protocol v1 over SSE.
 */

export interface ProgressState {
  stage: string;
  message: string;
  detail?: string;
  toolName?: string;
  timestamp: number;
}

export type UserTranscriptAttachment = {
  uri?: string;
  workspaceRelativePath?: string;
  mimeType?: string;
  name?: string;
  durationSeconds?: number;
};

export type AgentSseCallbacks = {
  onStreamStart: () => void;
  onUserTranscript?: (payload: { text: string; attachments?: UserTranscriptAttachment[] }) => void;
  onToken: (delta: string) => void;
  onThinking: (content: string, isDelta: boolean) => void;
  onThinkingEnd: () => void;
  onToolStart: (toolName: string, args?: unknown, toolCallId?: string) => void;
  onToolUpdate?: (toolName: string, toolCallId: string | undefined, details: unknown) => void;
  onToolEnd: (toolName: string, isError: boolean, result?: unknown, toolCallId?: string) => void;
  onProgress: (progress: ProgressState) => void;
  onTtsAudio?: (payload: {
    uri: string;
    mimeType: string;
    name: string;
    attachTo?: 'last_assistant';
    messageId?: string;
  }) => void;
  onClarifyRequest?: (payload: {
    requestId: string;
    question: string;
    choices?: string[];
    default?: string;
  }) => void;
  onResult: () => void;
  onError: (msg: string) => void;
};

export type AgentSseDispatchOptions = {
  /** Current session key (for persisting runId for abort/resume). */
  sseSessionKey?: string;
  savePendingRunId?: (sessionKey: string, runId: string) => void;
};

type ParsedEvent = {
  type?: unknown;
  runId?: unknown;
  payload?: unknown;
  timestamp?: unknown;
};

function payloadOf(parsed: ParsedEvent): Record<string, unknown> {
  return parsed.payload && typeof parsed.payload === 'object'
    ? parsed.payload as Record<string, unknown>
    : {};
}

function normalizedEventName(event: string, parsed: ParsedEvent): string {
  const payloadType = typeof parsed.type === 'string' ? parsed.type.trim() : '';
  return (event === 'message' || event === '') && payloadType ? payloadType : event;
}

function normalizeTranscriptAttachments(raw: unknown): UserTranscriptAttachment[] | undefined {
  const rawAttachments = Array.isArray(raw) ? raw : undefined;
  return rawAttachments
    ?.filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .map((item) => ({
      uri: typeof item.uri === 'string' ? item.uri : undefined,
      workspaceRelativePath:
        typeof item.workspaceRelativePath === 'string' ? item.workspaceRelativePath : undefined,
      mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
      name: typeof item.name === 'string' ? item.name : undefined,
      durationSeconds:
        typeof item.durationSeconds === 'number' && Number.isFinite(item.durationSeconds)
          ? item.durationSeconds
          : undefined,
    }));
}

function serializePayload(value: unknown): unknown {
  if (value == null || typeof value === 'string') return value;
  return value;
}

export function dispatchAgentSseEvent(
  event: string,
  data: string,
  cb: AgentSseCallbacks | undefined,
  options?: AgentSseDispatchOptions,
): void {
  let parsed: ParsedEvent;
  try {
    parsed = JSON.parse(data) as ParsedEvent;
  } catch {
    return;
  }

  const p = payloadOf(parsed);
  const effectiveEvent = normalizedEventName(event, parsed);

  switch (effectiveEvent) {
    case 'run_start':
      if (typeof parsed.runId === 'string' && options?.sseSessionKey) {
        options.savePendingRunId?.(options.sseSessionKey, parsed.runId);
      }
      cb?.onStreamStart();
      break;
    case 'user_transcript': {
      const text = typeof p.text === 'string' ? p.text : '';
      const attachments = normalizeTranscriptAttachments(p.attachments ?? p.media);
      cb?.onUserTranscript?.({ text, attachments });
      break;
    }
    case 'user_message':
      break;
    case 'assistant_message_start':
      cb?.onStreamStart();
      break;
    case 'assistant_delta':
      if (typeof p.delta === 'string' && p.delta) cb?.onToken(p.delta);
      break;
    case 'thinking_delta':
      if (typeof p.delta === 'string' && p.delta) cb?.onThinking(p.delta, true);
      break;
    case 'thinking_end':
    case 'assistant_message_end':
      cb?.onThinkingEnd();
      break;
    case 'tool_start': {
      const toolName = String(p.toolName || 'unknown');
      const toolCallId = typeof p.toolCallId === 'string' ? p.toolCallId : undefined;
      if (toolName === 'clarify') break;
      cb?.onToolStart(toolName, p.args, toolCallId);
      break;
    }
    case 'tool_update': {
      const toolName = typeof p.toolName === 'string' && p.toolName ? p.toolName : 'unknown';
      const toolCallId = typeof p.toolCallId === 'string' ? p.toolCallId : undefined;
      if (p.details !== undefined) cb?.onToolUpdate?.(toolName, toolCallId, p.details);
      if (typeof p.textDelta === 'string' && p.textDelta) {
        cb?.onToolUpdate?.(toolName, toolCallId, { textDelta: p.textDelta });
      }
      break;
    }
    case 'tool_end':
      cb?.onToolEnd(
        typeof p.toolName === 'string' && p.toolName ? p.toolName : 'unknown',
        p.status === 'error' || p.status === 'cancelled',
        serializePayload(p.result),
        typeof p.toolCallId === 'string' ? p.toolCallId : undefined,
      );
      break;
    case 'progress':
      cb?.onProgress({
        stage: String(p.stage || 'thinking'),
        message: String(p.message || ''),
        detail: p.detail as string | undefined,
        toolName: p.toolName as string | undefined,
        timestamp: Date.now(),
      });
      break;
    case 'compaction':
      if (typeof p.message === 'string') {
        cb?.onProgress({ stage: 'compaction', message: p.message, timestamp: Date.now() });
      }
      break;
    case 'tts_audio': {
      const uri = typeof p.uri === 'string' ? p.uri.trim() : '';
      if (!uri) break;
      cb?.onTtsAudio?.({
        uri,
        mimeType: String(p.mimeType || 'audio/mpeg'),
        name: String(p.name || 'voice.mp3'),
        attachTo: p.attachTo === 'last_assistant' ? 'last_assistant' : undefined,
        messageId: typeof p.messageId === 'string' ? p.messageId : undefined,
      });
      break;
    }
    case 'clarify_request': {
      const requestId = typeof p.requestId === 'string' ? p.requestId.trim() : '';
      const question = typeof p.question === 'string' ? p.question.trim() : '';
      if (requestId && question && cb?.onClarifyRequest) {
        const choices = Array.isArray(p.choices)
          ? (p.choices as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          : undefined;
        const def = typeof p.default === 'string' && p.default.trim() ? p.default.trim() : undefined;
        cb.onClarifyRequest({
          requestId,
          question,
          choices: choices && choices.length >= 2 ? choices : undefined,
          default: def,
        });
      }
      break;
    }
    case 'run_end':
      cb?.onResult();
      break;
    case 'error':
      cb?.onError(String(p.message || 'Send failed'));
      break;
  }
}

/** Incremental `text/event-stream` line parser (fetch stream, XHR progress, or buffered text). */
export class AgentSseLineParser {
  private buf = '';
  private evtType = '';
  private evtData = '';

  constructor(
    private readonly callbacks?: AgentSseCallbacks,
    private readonly options?: AgentSseDispatchOptions,
  ) {}

  feed(chunk: string): void {
    if (!chunk) return;
    this.buf += chunk.replace(/\r\n/g, '\n');
    this.drainCompleteLines();
  }

  flush(): void {
    this.drainCompleteLines();
    if (this.evtData) {
      dispatchAgentSseEvent(this.evtType || 'message', this.evtData, this.callbacks, this.options);
      this.evtType = '';
      this.evtData = '';
    }
  }

  private drainCompleteLines(): void {
    while (this.buf.includes('\n')) {
      const idx = this.buf.indexOf('\n');
      let line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      line = line.replace(/\r$/, '');
      this.processLine(line);
    }
  }

  private processLine(line: string): void {
    if (line.startsWith('event:')) {
      this.evtData = '';
      this.evtType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      const payload = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
      this.evtData += (this.evtData ? '\n' : '') + payload;
    } else if (line === '' && this.evtData) {
      dispatchAgentSseEvent(this.evtType || 'message', this.evtData, this.callbacks, this.options);
      this.evtType = '';
      this.evtData = '';
    }
  }
}

/** True when `fetch` exposes a readable `response.body` suitable for incremental SSE parsing. */
export function supportsReadableStreamBody(res: Response): boolean {
  const body = res.body;
  if (body == null || typeof TextDecoderStream === 'undefined') return false;
  try {
    return typeof body.getReader === 'function';
  } catch {
    return false;
  }
}

export function isEventStreamResponse(res: Response): boolean {
  return (res.headers.get('Content-Type') || '').includes('text/event-stream');
}

/** Parse a complete `text/event-stream` payload (buffered fallback). */
export function consumeAgentSseFromText(
  text: string,
  callbacks: AgentSseCallbacks | undefined,
  options?: AgentSseDispatchOptions,
): void {
  const parser = new AgentSseLineParser(callbacks, options);
  parser.feed(text);
  parser.flush();
}

export type AgentSseHttpInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | FormData;
  signal?: AbortSignal;
};

export type AgentSseHttpResult = {
  ok: boolean;
  status: number;
  statusText: string;
  responseText?: string;
};

/**
 * Use XHR `onprogress` for incremental SSE when `fetch().body` is unavailable (React Native Android/iOS).
 */
export function shouldUseXhrForAgentSse(): boolean {
  if (typeof XMLHttpRequest === 'undefined') return false;
  if (typeof document !== 'undefined') {
    try {
      const body = new Response('').body;
      if (body != null && typeof body.getReader === 'function' && typeof TextDecoderStream !== 'undefined') {
        return false;
      }
    } catch {
      /* use XHR */
    }
  }
  return true;
}

export function consumeAgentSseXhr(
  url: string,
  init: AgentSseHttpInit,
  callbacks: AgentSseCallbacks | undefined,
  options?: AgentSseDispatchOptions,
): Promise<AgentSseHttpResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const method = init.method ?? 'POST';
    xhr.open(method, url, true);

    const headers = init.headers ?? {};
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }

    const parser = new AgentSseLineParser(callbacks, options);
    let parsedLen = 0;
    let settled = false;

    const finish = (result: AgentSseHttpResult) => {
      if (settled) return;
      settled = true;
      init.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      init.signal?.removeEventListener('abort', onAbort);
      reject(err);
    };

    const drainProgress = () => {
      const text = xhr.responseText;
      if (text.length > parsedLen) {
        parser.feed(text.slice(parsedLen));
        parsedLen = text.length;
      }
    };

    const onAbort = () => {
      xhr.abort();
    };

    if (init.signal?.aborted) {
      fail(abortError());
      return;
    }
    init.signal?.addEventListener('abort', onAbort);

    xhr.onprogress = drainProgress;

    xhr.onload = () => {
      drainProgress();
      parser.flush();
      finish({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        statusText: xhr.statusText,
        responseText: xhr.responseText,
      });
    };

    xhr.onerror = () => {
      fail(new Error('Network request failed'));
    };

    xhr.onabort = () => {
      if (init.signal?.aborted) {
        fail(abortError());
        return;
      }
      fail(new Error('Request aborted'));
    };

    xhr.send(init.body ?? null);
  });
}

function abortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * Consume an agent SSE HTTP response, streaming when supported or buffering via `text()` otherwise.
 */
export async function consumeAgentSseResponse(
  res: Response,
  callbacks: AgentSseCallbacks | undefined,
  options?: AgentSseDispatchOptions,
): Promise<void> {
  if (supportsReadableStreamBody(res)) {
    await consumeAgentSseStream(res.body as ReadableStream<Uint8Array>, callbacks, options);
    return;
  }
  consumeAgentSseFromText(await res.text(), callbacks, options);
}

/**
 * Incrementally parse `text/event-stream` lines from a UTF-8 byte stream and dispatch events.
 */
export async function consumeAgentSseStream(
  body: ReadableStream<Uint8Array>,
  callbacks: AgentSseCallbacks | undefined,
  options?: AgentSseDispatchOptions,
): Promise<void> {
  const parser = new AgentSseLineParser(callbacks, options);
  const reader = body
    .pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)
    .getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(value);
    }
    parser.flush();
  } finally {
    reader.releaseLock();
  }
}
