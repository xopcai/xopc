import type { ProgressState } from '@/features/chat/messages.types';
import { MAX_CHAT_ATTACHMENTS } from '@/features/chat/constants';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export function pendingAgentRunStorageKey(chatId: string): string {
  return `xopcbot:pendingRun:${chatId}`;
}

export type MessagingCallbacks = {
  onStreamStart: () => void;
  onToken: (delta: string) => void;
  onThinking: (content: string, isDelta: boolean) => void;
  onThinkingEnd: () => void;
  onToolStart: (toolName: string, args?: unknown) => void;
  onToolEnd: (toolName: string, isError: boolean, result?: string) => void;
  onProgress: (progress: ProgressState) => void;
  onResult: () => void;
  onError: (msg: string) => void;
};

/**
 * POST `/api/agent` with `Accept: text/event-stream` and consume SSE from the response body
 * (same protocol as `ui/src/chat/messaging.ts`).
 */
export class MessageSender {
  private _abort?: AbortController;
  private _sseChatId = '';

  get isSending() {
    return !!this._abort;
  }

  async send(
    content: string,
    chatId: string,
    attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>,
    thinkingLevel?: string,
    callbacks?: MessagingCallbacks,
  ): Promise<void> {
    this._abort = new AbortController();
    this._sseChatId = chatId;

    const capped =
      attachments && attachments.length > MAX_CHAT_ATTACHMENTS
        ? attachments.slice(0, MAX_CHAT_ATTACHMENTS)
        : attachments;

    const res = await apiFetch(apiUrl('/api/agent'), {
      method: 'POST',
      headers: { Accept: 'text/event-stream' },
      body: JSON.stringify({
        message: content,
        channel: 'webchat',
        chatId,
        attachments: capped,
        thinking: thinkingLevel,
      }),
      signal: this._abort.signal,
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(body.error?.message || `HTTP ${res.status}`);
    }

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('text/event-stream') && res.body) {
      await this._consumeSSE(res.body, callbacks);
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
    this._abort?.abort();
    this._abort = undefined;
  }

  async resume(runId: string, chatId: string, callbacks?: MessagingCallbacks): Promise<void> {
    this._abort = new AbortController();
    this._sseChatId = chatId;

    const res = await apiFetch(apiUrl('/api/agent/resume'), {
      method: 'POST',
      headers: { Accept: 'text/event-stream' },
      body: JSON.stringify({ runId, chatId }),
      signal: this._abort.signal,
    });

    if (!res.ok) {
      this._clearPendingRun();
      this._abort = undefined;
      return;
    }

    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('text/event-stream') && res.body) {
      await this._consumeSSE(res.body, callbacks);
    }

    this._clearPendingRun();
    this._abort = undefined;
  }

  private _clearPendingRun(): void {
    if (this._sseChatId) {
      try {
        sessionStorage.removeItem(pendingAgentRunStorageKey(this._sseChatId));
      } catch {
        /* ignore */
      }
    }
  }

  private async _consumeSSE(body: ReadableStream<Uint8Array>, callbacks?: MessagingCallbacks): Promise<void> {
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
            this._dispatchSSE(evtType || 'message', evtData, callbacks);
            evtType = '';
            evtData = '';
          }
        }
      }
      if (evtData) this._dispatchSSE(evtType || 'message', evtData, callbacks);
    } finally {
      reader.releaseLock();
    }
  }

  private _dispatchSSE(event: string, data: string, cb?: MessagingCallbacks): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }

    switch (event) {
      case 'status':
        if (typeof parsed.runId === 'string' && this._sseChatId) {
          try {
            sessionStorage.setItem(
              pendingAgentRunStorageKey(this._sseChatId),
              JSON.stringify({ runId: parsed.runId }),
            );
          } catch {
            /* ignore */
          }
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
      case 'tool_start':
        cb?.onToolStart(String(parsed.toolName || 'unknown'), parsed.args);
        break;
      case 'tool_end':
        cb?.onToolEnd(String(parsed.toolName), !!parsed.isError, parsed.result as string | undefined);
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
}
