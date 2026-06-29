import { buildSendFailedErrorPayload } from '@/features/chat/messages/agent-run-error-parser';
import type { WireAttachment } from '@/features/chat/composer/composer.types';
import type { Message, ProgressState } from '@/features/chat/messages/messages.types';
import { userMessageFromSsePayload } from '@/features/chat/messages/user-message-from-sse';
import { MAX_CHAT_ATTACHMENTS } from '@/features/chat/constants';
import { dispatchPendingAgentRunChanged } from '@/features/chat/follow-up/pending-agent-run-events';
import { apiFetch } from '@/lib/fetch';
import { formatApiHttpError } from '@/lib/http-error-message';
import { apiUrl } from '@/lib/url';

export function pendingAgentRunStorageKey(chatId: string): string {
  return `xopc:pendingRun:${chatId}`;
}

/** True when sessionStorage still holds a runId for a webchat session (in-flight or resumable). */
export function hasPendingAgentRunForChat(chatId: string): boolean {
  try {
    const raw = globalThis.sessionStorage?.getItem(pendingAgentRunStorageKey(chatId));
    if (!raw) return false;
    const pr = JSON.parse(raw) as { runId?: unknown };
    return typeof pr.runId === 'string' && pr.runId.trim().length > 0;
  } catch {
    return false;
  }
}

/** Persist run id for sidebar + `tryResumeAgentRun` (POST body or gateway `/api/events` `agent.stream`). */
export function setPendingAgentRun(chatId: string, runId: string): void {
  const id = runId.trim();
  if (!id) return;
  try {
    sessionStorage.setItem(pendingAgentRunStorageKey(chatId), JSON.stringify({ runId: id }));
    dispatchPendingAgentRunChanged(chatId);
  } catch {
    /* ignore */
  }
}

/** Drop stored run id when leaving a session (e.g. New chat). Does not abort HTTP. */
export function clearPendingAgentRunForChat(chatId: string): void {
  const key = String(chatId ?? '').trim();
  if (!key) return;
  try {
    sessionStorage.removeItem(pendingAgentRunStorageKey(key));
    dispatchPendingAgentRunChanged(key);
  } catch {
    /* ignore */
  }
}

export type CompactionState = {
  status: 'started' | 'completed' | 'skipped';
  tokensBefore?: number;
  tokensAfter?: number;
  summary?: string;
};

export type MessagingCallbacks = {
  onStreamStart: () => void;
  onToken: (delta: string) => void;
  onThinking: (content: string, isDelta: boolean) => void;
  onThinkingEnd: () => void;
  onToolStart: (toolName: string, args?: unknown, toolCallId?: string) => void;
  onToolEnd: (toolName: string, isError: boolean, result?: unknown) => void;
  /**
   * Mid-execution structured update for a tool whose `partialResult` carried
   * `details`. Only emitted today by the `workflow` tool — feeds the
   * WorkflowCard's live progress tree.
   */
  onToolUpdate?: (toolName: string, toolCallId: string | undefined, details: unknown) => void;
  onProgress: (progress: ProgressState) => void;
  /** Context compaction in progress (pre-turn automatic or manual). */
  onCompaction?: (state: CompactionState) => void;
  /** Assistant TTS audio persisted under agent home `tts/` (before `run_end`). */
  onTtsAudio?: (payload: {
    uri: string;
    mimeType: string;
    name: string;
    attachTo?: 'last_assistant';
    messageId?: string;
  }) => void;
  /** Agent `clarify` tool — user must answer via POST /api/clarify/:requestId */
  onClarifyRequest?: (payload: {
    requestId: string;
    question: string;
    choices?: string[];
    default?: string;
  }) => void;
  /** User turn from another device or early in the POST stream (before assistant tokens). */
  onUserMessage?: (message: Message) => void;
  /** Slash command or tool path started a persisted workflow run. */
  onWorkflowRunStarted?: (payload: {
    runId: string;
    sessionKey: string;
    definitionId: string;
    parentSessionKey?: string;
  }) => void;
  onResult: () => void;
  onError: (msg: string) => void;
};

/**
 * POST `/api/agent` with `Accept: text/event-stream` and consume SSE from the response body
 * (SSE events on the HTTP response body).
 */
export class MessageSender {
  private _abort?: AbortController;
  private _sseChatId = '';
  /** `runId` from the `run_start` event for this POST/resume body; do not clear a newer pending run (scheduled continuation). */
  private _trackedRunId?: string;

  get isSending() {
    return !!this._abort;
  }

  /** Chat id for the in-flight POST `/api/agent` or `/api/agent/resume` body, if any. */
  get activeChatId(): string {
    return this._sseChatId;
  }

  isStreamingFor(chatId: string): boolean {
    return !!this._abort && this._sseChatId === chatId;
  }

  async send(
    content: string,
    chatId: string,
    attachments?: WireAttachment[],
    thinkingLevel?: string,
    callbacks?: MessagingCallbacks,
  ): Promise<void> {
    this._trackedRunId = undefined;
    this._abort = new AbortController();
    this._sseChatId = chatId;

    const capped =
      attachments && attachments.length > MAX_CHAT_ATTACHMENTS
        ? attachments.slice(0, MAX_CHAT_ATTACHMENTS)
        : attachments;

    const clientCreatedAtMs = Date.now();

    const res = await apiFetch(apiUrl('/api/agent'), {
      method: 'POST',
      headers: { Accept: 'text/event-stream' },
        body: JSON.stringify({
          message: content,
          channel: 'webchat',
          sessionKey: chatId,
          attachments: capped,
          thinking: thinkingLevel,
          clientCreatedAtMs,
      }),
      signal: this._abort.signal,
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(formatApiHttpError(res.status, res.statusText, body.error?.message));
    }

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('text/event-stream') && res.body) {
      const terminal = this._wrapTerminalCallbacks(callbacks);
      await this._consumeSSE(res.body, terminal.wrapped);
      // If the HTTP body closed without a `run_end` / `error` event (proxy drop, parse miss, etc.),
      // the UI would otherwise keep `streaming` true and block the next send — see use-chat-session guard.
      if (!terminal.sawTerminal && !this._abort?.signal.aborted) {
        terminal.onMissingTerminal();
      }
    } else {
      const json = (await res.json()) as { ok?: boolean; payload?: { content?: string } };
      if (json.ok && json.payload?.content) {
        callbacks?.onToken(json.payload.content);
        callbacks?.onResult();
      }
    }

    this._clearPendingRun();
    this._abort = undefined;
  }

  abort(): void {
    this._notifyServerAbort();
    this._abort?.abort();
    this._abort = undefined;
    this._clearPendingRun();
  }

  /** Best-effort server-side abort (runId) so the agent stops even if the HTTP signal is flaky. */
  private _notifyServerAbort(): void {
    if (!this._sseChatId) {
      return;
    }
    try {
      const raw = sessionStorage.getItem(pendingAgentRunStorageKey(this._sseChatId));
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as { runId?: string };
      if (typeof parsed.runId !== 'string' || !parsed.runId) {
        return;
      }
      void apiFetch(apiUrl('/api/agent/abort'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: parsed.runId }),
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  async resume(runId: string, chatId: string, callbacks?: MessagingCallbacks): Promise<void> {
    this._trackedRunId = undefined;
    this._abort = new AbortController();
    this._sseChatId = chatId;

    const res = await apiFetch(apiUrl('/api/agent/resume'), {
      method: 'POST',
      headers: { Accept: 'text/event-stream' },
      body: JSON.stringify({ runId, sessionKey: chatId }),
      signal: this._abort.signal,
    });

    if (!res.ok) {
      this._clearPendingRun();
      this._abort = undefined;
      return;
    }

    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('text/event-stream') && res.body) {
      const terminal = this._wrapTerminalCallbacks(callbacks);
      await this._consumeSSE(res.body, terminal.wrapped);
      if (!terminal.sawTerminal && !this._abort?.signal.aborted) {
        terminal.onMissingTerminal();
      }
    }

    this._clearPendingRun();
    this._abort = undefined;
  }

  /** Ensures at most one of onResult/onError fires from the wrapped callbacks. */
  private _wrapTerminalCallbacks(cb?: MessagingCallbacks): {
    wrapped: MessagingCallbacks | undefined;
    sawTerminal: boolean;
    onMissingTerminal: () => void;
  } {
    if (!cb) {
      return { wrapped: undefined, sawTerminal: false, onMissingTerminal: () => {} };
    }
    let sawTerminal = false;
    const markTerminal = () => {
      sawTerminal = true;
    };
    return {
      get sawTerminal() {
        return sawTerminal;
      },
      wrapped: {
        ...cb,
        onResult: () => {
          if (sawTerminal) return;
          markTerminal();
          cb.onResult();
        },
        onError: (msg: string) => {
          if (sawTerminal) return;
          markTerminal();
          cb.onError(msg);
        },
      },
      onMissingTerminal: () => {
        if (sawTerminal) return;
        markTerminal();
        cb.onResult();
      },
    };
  }

  private _clearPendingRun(): void {
    const chatId = this._sseChatId;
    if (chatId) {
      try {
        const key = pendingAgentRunStorageKey(chatId);
        const raw = sessionStorage.getItem(key);
        if (raw) {
          const pr = JSON.parse(raw) as { runId?: string };
          const stored = typeof pr?.runId === 'string' ? pr.runId : '';
          if (this._trackedRunId && stored && stored !== this._trackedRunId) {
            return;
          }
        }
        sessionStorage.removeItem(key);
        dispatchPendingAgentRunChanged(chatId);
      } catch {
        /* ignore */
      }
    }
    this._trackedRunId = undefined;
  }

  private async _consumeSSE(body: ReadableStream<Uint8Array>, callbacks?: MessagingCallbacks): Promise<void> {
    const reader = body
      .pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)
      .getReader();
    let buf = '';
    let evtType = '';
    let evtData = '';

    const readChunk = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) {
        if (evtData) this._dispatchSSE(evtType || 'message', evtData, callbacks);
        return;
      }
      buf += value;

      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const rawLine of lines) {
        let line = rawLine.replace(/\r$/, '');

        if (line.startsWith('event:')) {
          evtData = '';
          evtType = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          const payload = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
          evtData += (evtData ? '\n' : '') + payload;
        } else if (line === '' && evtData) {
          this._dispatchSSE(evtType || 'message', evtData, callbacks);
          evtType = '';
          evtData = '';
        }
      }
      await readChunk();
    };

    try {
      await readChunk();
    } finally {
      reader.releaseLock();
    }
  }

  private _dispatchSSE(event: string, data: string, cb?: MessagingCallbacks): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      if (event === 'run_end') cb?.onResult();
      return;
    }

    const payload = (parsed.payload && typeof parsed.payload === 'object'
      ? parsed.payload
      : {}) as Record<string, unknown>;

    switch (event) {
      case 'run_start':
        if (typeof parsed.runId === 'string' && this._sseChatId) {
          this._trackedRunId = parsed.runId;
          setPendingAgentRun(this._sseChatId, parsed.runId);
        }
        cb?.onStreamStart();
        break;
      case 'user_message': {
        const userMsg = userMessageFromSsePayload(payload.message as Record<string, unknown>);
        if (userMsg) cb?.onUserMessage?.(userMsg);
        break;
      }
      case 'user_transcript': {
        const userMsg = userMessageFromSsePayload({
          text: payload.text,
          media: payload.media,
          timestamp: parsed.timestamp,
        });
        if (userMsg) cb?.onUserMessage?.(userMsg);
        break;
      }
      case 'assistant_message_start':
        cb?.onStreamStart();
        break;
      case 'assistant_delta':
        if (typeof payload.delta === 'string' && payload.delta) cb?.onToken(payload.delta);
        break;
      case 'thinking_delta':
        if (typeof payload.delta === 'string' && payload.delta) cb?.onThinking(payload.delta, true);
        break;
      case 'thinking_end':
      case 'assistant_message_end':
        cb?.onThinkingEnd();
        break;
      case 'tool_start': {
        const toolName = String(payload.toolName || 'unknown');
        const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : undefined;
        if (toolName === 'clarify') break;
        cb?.onToolStart(toolName, payload.args, toolCallId);
        break;
      }
      case 'tool_update': {
        const toolName = typeof payload.toolName === 'string' && payload.toolName ? payload.toolName : 'unknown';
        const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : undefined;
        if (payload.details !== undefined) cb?.onToolUpdate?.(toolName, toolCallId, payload.details);
        if (typeof payload.textDelta === 'string' && payload.textDelta) cb?.onToolUpdate?.(toolName, toolCallId, { textDelta: payload.textDelta });
        break;
      }
      case 'tool_end':
        cb?.onToolEnd(
          typeof payload.toolName === 'string' && payload.toolName ? payload.toolName : 'unknown',
          payload.status === 'error' || payload.status === 'cancelled',
          serializeProtocolPayload(payload.result),
        );
        break;
      case 'progress':
        cb?.onProgress({
          stage: String(payload.stage || 'thinking'),
          message: String(payload.message || ''),
          detail: payload.detail as string | undefined,
          toolName: payload.toolName as string | undefined,
          timestamp: Date.now(),
        });
        break;
      case 'compaction':
        cb?.onCompaction?.({
          status: (payload.status as 'started' | 'completed' | 'skipped') || 'started',
          tokensBefore: typeof payload.tokensBefore === 'number' ? payload.tokensBefore : undefined,
          tokensAfter: typeof payload.tokensAfter === 'number' ? payload.tokensAfter : undefined,
          summary: typeof payload.summary === 'string' ? payload.summary : undefined,
        });
        break;
      case 'tts_audio':
        cb?.onTtsAudio?.({
          uri: String(payload.uri || ''),
          mimeType: String(payload.mimeType || 'audio/mpeg'),
          name: String(payload.name || 'voice.mp3'),
          attachTo: payload.attachTo === 'last_assistant' ? 'last_assistant' : undefined,
          messageId: typeof payload.messageId === 'string' ? payload.messageId : undefined,
        });
        break;
      case 'clarify_request': {
        const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : '';
        const question = typeof payload.question === 'string' ? payload.question.trim() : '';
        if (requestId && question && cb?.onClarifyRequest) {
          const choices = Array.isArray(payload.choices)
            ? (payload.choices as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
            : undefined;
          const def = typeof payload.default === 'string' && payload.default.trim() ? payload.default.trim() : undefined;
          cb.onClarifyRequest({ requestId, question, choices: choices && choices.length >= 2 ? choices : undefined, default: def });
        }
        break;
      }
      case 'workflow_run_started': {
        const workflowRun = payload.workflowRun as Record<string, unknown> | undefined;
        if (workflowRun?.ok === true) {
          const runId = typeof workflowRun.runId === 'string' ? workflowRun.runId : '';
          const sessionKey = typeof workflowRun.sessionKey === 'string' ? workflowRun.sessionKey : '';
          const definitionId = typeof workflowRun.definitionId === 'string' ? workflowRun.definitionId : '';
          const parentSessionKey = typeof workflowRun.parentSessionKey === 'string' ? workflowRun.parentSessionKey : undefined;
          if (runId && sessionKey && definitionId) {
            cb?.onWorkflowRunStarted?.({ runId, sessionKey, definitionId, parentSessionKey });
          }
        }
        break;
      }
      case 'run_end':
        cb?.onResult();
        break;
      case 'error':
        cb?.onError(String(payload.message || JSON.stringify(buildSendFailedErrorPayload())));
        break;
    }
  }
}

function serializeProtocolPayload(result: unknown): unknown {
  if (typeof result === 'string' || result == null) return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}
