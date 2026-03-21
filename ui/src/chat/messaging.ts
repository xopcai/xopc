import type { Message, ProgressState, ToolCall, GatewayClientConfig } from './types.js';
import { apiUrl, authHeaders } from './helpers.js';

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

export class MessageSender {
  private _abort?: AbortController;

  constructor(private _config: GatewayClientConfig) {}

  get isSending() { return !!this._abort; }

  async send(
    content: string,
    chatId: string,
    attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>,
    thinkingLevel?: string,
    callbacks?: MessagingCallbacks,
  ): Promise<void> {
    this._abort = new AbortController();

    const res = await fetch(apiUrl('/api/agent'), {
      method: 'POST',
      headers: { ...authHeaders(this._config.token), Accept: 'text/event-stream' },
      body: JSON.stringify({ message: content, channel: 'webchat', chatId, attachments, thinking: thinkingLevel }),
      signal: this._abort.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message || `HTTP ${res.status}`);
    }

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('text/event-stream') && res.body) {
      await this._consumeSSE(res.body, callbacks);
    } else {
      const json = await res.json();
      if (json.ok && json.payload?.content) {
        callbacks?.onToken(json.payload.content);
        callbacks?.onResult();
      }
    }

    this._abort = undefined;
  }

  abort(): void {
    this._abort?.abort();
    this._abort = undefined;
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
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);

          if (line.startsWith('event:')) {
            evtType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            evtData += (evtData ? '\n' : '') + line.slice(5).trim();
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
    let parsed: any;
    try { parsed = JSON.parse(data); } catch { return; }

    switch (event) {
      case 'status': cb?.onStreamStart(); break;
      case 'token': if (parsed.content) cb?.onToken(parsed.content); break;
      case 'thinking':
        if (parsed.status === 'started') cb?.onThinking('', false);
        cb?.onThinking(parsed.content || '', parsed.delta || false);
        break;
      case 'thinking_end': cb?.onThinkingEnd(); break;
      case 'tool_start': cb?.onToolStart(parsed.toolName || 'unknown', parsed.args); break;
      case 'tool_end': cb?.onToolEnd(parsed.toolName, !!parsed.isError, parsed.result); break;
      case 'progress':
        cb?.onProgress({ stage: parsed.stage || 'thinking', message: parsed.message || '', detail: parsed.detail, toolName: parsed.toolName, timestamp: Date.now() });
        break;
      case 'result': cb?.onResult(); break;
      case 'error': cb?.onError(parsed.content || parsed.error?.message || 'Send failed'); break;
      default: if (parsed.content) cb?.onToken(parsed.content); break;
    }
  }
}
