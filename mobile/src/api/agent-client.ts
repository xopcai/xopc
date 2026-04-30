import {
  consumeAgentSseStream,
  type AgentSseCallbacks,
  type AgentSseDispatchOptions,
} from '@xopcai/gateway-sse-client';

import { apiFetch, formatApiHttpError } from './client';
import { pendingRunStorageKey, storage } from '../storage/mmkv';

export type MessagingCallbacks = AgentSseCallbacks;

function wrapTerminalCallbacks(cb?: MessagingCallbacks): {
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

function sseDispatchOptions(sseChatId: string): AgentSseDispatchOptions {
  return {
    sseChatId,
    savePendingRunId: (chatId, runId) => {
      storage.set(pendingRunStorageKey(chatId), JSON.stringify({ runId }));
    },
  };
}

/**
 * Streams agent output from `POST /api/agent` (and resume), matching the web gateway console.
 */
export class AgentMessageSender {
  private _abort?: AbortController;
  private _sseChatId = '';

  get isSending() {
    return !!this._abort;
  }

  async send(
    path: string,
    body: Record<string, unknown>,
    callbacks?: MessagingCallbacks,
    thinkingLevel?: string,
  ): Promise<void> {
    this._abort = new AbortController();
    const chatId = typeof body.chatId === 'string' ? body.chatId : typeof body.sessionKey === 'string' ? body.sessionKey : '';
    this._sseChatId = chatId;

    const mergedBody = {
      ...body,
      channel: 'webchat',
      ...(thinkingLevel?.trim() ? { thinking: thinkingLevel.trim() } : {}),
    };

    const res = await apiFetch(path, {
      method: 'POST',
      headers: { Accept: 'text/event-stream' },
      body: JSON.stringify(mergedBody),
      signal: this._abort.signal,
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(formatApiHttpError(res.status, res.statusText, errBody.error?.message));
    }

    await Promise.resolve();

    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('text/event-stream') && res.body) {
      const terminal = wrapTerminalCallbacks(callbacks);
      const opts = sseDispatchOptions(this._sseChatId);
      await consumeAgentSseStream(res.body, terminal.wrapped, opts);
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
  }

  private _notifyServerAbort(): void {
    if (!this._sseChatId) return;
    try {
      const raw = storage.getString(pendingRunStorageKey(this._sseChatId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as { runId?: string };
      if (typeof parsed.runId !== 'string' || !parsed.runId) return;
      void apiFetch('/api/agent/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: parsed.runId }),
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  private _clearPendingRun(): void {
    if (this._sseChatId) {
      try {
        storage.delete(pendingRunStorageKey(this._sseChatId));
      } catch {
        /* ignore */
      }
    }
  }

  async sendMessage(
    message: string,
    sessionKey: string,
    callbacks?: MessagingCallbacks,
    thinkingLevel?: string,
  ): Promise<void> {
    return this.send(
      '/api/agent',
      { message, sessionKey },
      callbacks,
      thinkingLevel,
    );
  }

  async resume(runId: string, chatId: string, callbacks?: MessagingCallbacks, _thinkingLevel?: string): Promise<void> {
    this._abort = new AbortController();
    this._sseChatId = chatId;

    const res = await apiFetch('/api/agent/resume', {
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
      const terminal = wrapTerminalCallbacks(callbacks);
      await consumeAgentSseStream(res.body, terminal.wrapped, sseDispatchOptions(chatId));
      if (!terminal.sawTerminal && !this._abort?.signal.aborted) {
        terminal.onMissingTerminal();
      }
    }

    this._clearPendingRun();
    this._abort = undefined;
  }
}
