/**
 * Client-side parsing for xopc gateway `POST /api/agent` (and resume) SSE streams.
 * Mirrors `web/src/features/chat/message-sender.ts` dispatch semantics.
 */

export interface ProgressState {
  stage: string;
  message: string;
  detail?: string;
  toolName?: string;
  timestamp: number;
}

export type AgentSseCallbacks = {
  onStreamStart: () => void;
  onToken: (delta: string) => void;
  onThinking: (content: string, isDelta: boolean) => void;
  onThinkingEnd: () => void;
  onToolStart: (toolName: string, args?: unknown) => void;
  onToolEnd: (toolName: string, isError: boolean, result?: string) => void;
  onProgress: (progress: ProgressState) => void;
  onTtsAudio?: (payload: { workspaceRelativePath: string; mimeType: string; name: string }) => void;
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
  /** Current chat/session key (for persisting runId for abort). */
  sseChatId?: string;
  savePendingRunId?: (chatId: string, runId: string) => void;
};

export function dispatchAgentSseEvent(
  event: string,
  data: string,
  cb: AgentSseCallbacks | undefined,
  options?: AgentSseDispatchOptions,
): void {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data) as Record<string, unknown>;
  } catch {
    if (event === 'result') {
      cb?.onResult();
    }
    return;
  }

  const sseChatId = options?.sseChatId;

  switch (event) {
    case 'status':
      if (typeof parsed.runId === 'string' && sseChatId) {
        options?.savePendingRunId?.(sseChatId, parsed.runId);
      }
      cb?.onStreamStart();
      break;
    case 'token': {
      const chunk =
        typeof parsed.content === 'string'
          ? parsed.content
          : typeof parsed.delta === 'string'
            ? parsed.delta
            : typeof parsed.text === 'string'
              ? parsed.text
              : '';
      if (chunk) cb?.onToken(chunk);
      break;
    }
    case 'thinking':
      if (parsed.status === 'started') {
        cb?.onThinking('', false);
        break;
      }
      cb?.onThinking(String(parsed.content || ''), Boolean(parsed.delta));
      break;
    case 'thinking_end':
      cb?.onThinkingEnd();
      break;
    case 'message_end':
      cb?.onThinkingEnd();
      break;
    case 'tool_start': {
      const toolName = String(parsed.toolName || 'unknown');
      if (toolName === 'clarify') break;
      cb?.onToolStart(toolName, parsed.args);
      break;
    }
    case 'tool_end':
      cb?.onToolEnd(
        typeof parsed.toolName === 'string' && parsed.toolName ? parsed.toolName : 'unknown',
        !!parsed.isError,
        parsed.result as string | undefined,
      );
      break;
    case 'progress':
      cb?.onProgress({
        stage: String(parsed.stage || 'thinking'),
        message: String(parsed.message || ''),
        detail: parsed.detail as string | undefined,
        toolName: parsed.toolName as string | undefined,
        timestamp: Date.now(),
      });
      break;
    case 'tts_audio':
      cb?.onTtsAudio?.({
        workspaceRelativePath: String(parsed.workspaceRelativePath || ''),
        mimeType: String(parsed.mimeType || 'audio/mpeg'),
        name: String(parsed.name || 'voice.mp3'),
      });
      break;
    case 'clarify_request': {
      const requestId = typeof parsed.requestId === 'string' ? parsed.requestId.trim() : '';
      const question = typeof parsed.question === 'string' ? parsed.question.trim() : '';
      if (requestId && question && cb?.onClarifyRequest) {
        const choices = Array.isArray(parsed.choices)
          ? (parsed.choices as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          : undefined;
        const def =
          typeof parsed.default === 'string' && parsed.default.trim() ? parsed.default.trim() : undefined;
        cb.onClarifyRequest({
          requestId,
          question,
          choices: choices && choices.length >= 2 ? choices : undefined,
          default: def,
        });
      }
      break;
    }
    case 'result':
      cb?.onResult();
      break;
    case 'error':
      cb?.onError(
        String(
          parsed.content ||
            (parsed.error as { message?: string } | undefined)?.message ||
            'Send failed',
        ),
      );
      break;
    default: {
      const chunk =
        typeof parsed.content === 'string'
          ? parsed.content
          : typeof parsed.delta === 'string'
            ? parsed.delta
            : typeof parsed.text === 'string'
              ? parsed.text
              : '';
      if (chunk) cb?.onToken(chunk);
      break;
    }
  }
}

/**
 * Incrementally parse `text/event-stream` lines from a UTF-8 byte stream and dispatch events.
 */
export async function consumeAgentSseStream(
  body: ReadableStream<Uint8Array>,
  callbacks: AgentSseCallbacks | undefined,
  options?: AgentSseDispatchOptions,
): Promise<void> {
  const reader = body
    .pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)
    .getReader();
  let buf = '';
  let evtType = '';
  let evtData = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += value;

      while (buf.includes('\n')) {
        const idx = buf.indexOf('\n');
        let line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        line = line.replace(/\r$/, '');

        if (line.startsWith('event:')) {
          evtData = '';
          evtType = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          const payload = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
          evtData += (evtData ? '\n' : '') + payload;
        } else if (line === '' && evtData) {
          dispatchAgentSseEvent(evtType || 'message', evtData, callbacks, options);
          evtType = '';
          evtData = '';
        }
      }
    }
    if (evtData) dispatchAgentSseEvent(evtType || 'message', evtData, callbacks, options);
  } finally {
    reader.releaseLock();
  }
}
