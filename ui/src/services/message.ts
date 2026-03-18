// MessageService - Manages message sending and streaming

import { getStore } from '../core/store.js';
import { apiUrl, authHeaders } from '../utils/api.js';
import type { Message } from '../core/store.js';

const store = getStore();

export interface SendMessageOptions {
  message: string;
  channel?: string;
  chatId?: string;
  attachments?: Array<{
    type: string;
    mimeType?: string;
    data?: string;
    name?: string;
    size?: number;
  }>;
}

export interface AgentResponse {
  ok: boolean;
  payload?: {
    content?: string;
    [key: string]: unknown;
  };
  error?: {
    message: string;
  };
}

export class MessageService {
  private _token?: string;
  private _abortController?: AbortController;

  constructor(token?: string) {
    this._token = token;
  }

  setToken(token: string): void {
    this._token = token;
  }

  get isStreaming(): boolean {
    return store.getState().message.streaming.isActive;
  }

  abort(): void {
    this._abortController?.abort();
    this._abortController = undefined;
    store.getState().setStreamingActive(false);
  }

  async sendMessage(options: SendMessageOptions): Promise<void> {
    if (this.isStreaming) {
      throw new Error('Already sending a message');
    }

    const { message, channel = 'gateway', chatId = 'default', attachments } = options;

    if (!message.trim() && !attachments?.length) {
      throw new Error('Message cannot be empty');
    }

    const userMessage: Message = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: message ? [{ type: 'text', text: message }] : [],
      attachments,
      timestamp: Date.now(),
    };
    store.getState().addMessage(userMessage);

    store.getState().setStreamingActive(true);
    store.getState().setStreamingContent('');

    this._abortController = new AbortController();

    try {
      const url = apiUrl('/api/agent');
      const headers = {
        ...authHeaders(this._token),
        Accept: 'text/event-stream',
      };

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message,
          channel,
          chatId,
          attachments,
        }),
        signal: this._abortController.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || `HTTP ${res.status}`);
      }

      const contentType = res.headers.get('Content-Type') || '';

      if (contentType.includes('text/event-stream') && res.body) {
        await this._handleSSEStream(res.body);
      } else {
        const json: AgentResponse = await res.json();
        if (json.ok && json.payload?.content) {
          store.getState().setStreamingContent(json.payload.content);
          store.getState().finalizeStreaming();
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.log('[MessageService] Request aborted');
        return;
      }

      const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
      store.getState().setMessageError(errorMessage);
      store.getState().setStreamingActive(false);
      throw error;
    } finally {
      this._abortController = undefined;
    }
  }

  private async _handleSSEStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
    let buffer = '';
    let currentEventType = '';
    let currentEventData = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += value;

        while (buffer.includes('\n')) {
          const newlineIndex = buffer.indexOf('\n');
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.startsWith('event:')) {
            currentEventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            currentEventData += (currentEventData ? '\n' : '') + line.slice(5).trim();
          } else if (line === '') {
            if (currentEventData) {
              this._handleSSEEvent(currentEventType || 'message', currentEventData);
              currentEventType = '';
              currentEventData = '';
            }
          }
        }
      }

      if (buffer.trim() || currentEventData) {
        if (buffer.trim()) {
          const lines = buffer.split('\n');
          for (const line of lines) {
            if (line.startsWith('event:')) {
              currentEventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              currentEventData += (currentEventData ? '\n' : '') + line.slice(5).trim();
            } else if (line === '' && currentEventData) {
              this._handleSSEEvent(currentEventType || 'message', currentEventData);
              currentEventType = '';
              currentEventData = '';
            }
          }
        }
        if (currentEventData) {
          this._handleSSEEvent(currentEventType || 'message', currentEventData);
        }
      }
    } catch (err) {
      console.error('[MessageService] SSE stream error:', err);
      store.getState().setMessageError('Stream processing error');
    } finally {
      reader.releaseLock();
    }
  }

  private _handleSSEEvent(event: string, data: string): void {
    try {
      const parsed = JSON.parse(data);

      switch (event) {
        case 'status':
          store.getState().setStreamingActive(true);
          break;

        case 'token':
          if (parsed.content) {
            // Append mode (backend now sends delta/incremental text)
            const current = store.getState().message.streaming.content || '';
            store.getState().setStreamingContent(current + parsed.content);
          }
          break;

        case 'thinking':
          // When status is 'started', reset streaming content for new message
          if (parsed.status === 'started') {
            store.getState().setStreamingContent('');
          }
          // Thinking events - handled by UI components
          break;

        case 'thinking_end':
          // Thinking end - handled by UI components
          break;

        case 'tool_start':
          // Tool execution start - handled by UI components
          break;

        case 'tool_end':
          // Tool execution end - handled by UI components
          break;

        case 'message_end':
          // Message end - handled by result event
          break;

        case 'progress':
          // Progress updates - handled by UI components
          break;

        case 'error': {
          const errorMsg = parsed.content || parsed.error?.message || 'Message failed';
          store.getState().setMessageError(errorMsg);
          store.getState().setStreamingActive(false);
          break;
        }

        case 'result':
          store.getState().finalizeStreaming();
          break;

        default:
          // Unknown event - ignore to prevent incorrect content append
          break;
      }
    } catch {
      // Ignore parse errors
    }
  }

  clearMessages(): void {
    store.getState().clearMessages();
  }
}

let messageServiceInstance: MessageService | null = null;

export function getMessageService(token?: string): MessageService {
  if (!messageServiceInstance) {
    messageServiceInstance = new MessageService(token);
  } else if (token) {
    messageServiceInstance.setToken(token);
  }
  return messageServiceInstance;
}

export function resetMessageService(): void {
  messageServiceInstance?.abort();
  messageServiceInstance = null;
}
