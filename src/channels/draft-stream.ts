/**
 * Telegram Draft Stream for Streaming Message Previews
 * 
 * Implements real-time message streaming with edit-based updates
 * Inspired by openclaw's draft-stream.ts
 */

import type { Bot } from 'grammy';
import { createLogger } from '../utils/logger.js';

const log = createLogger('DraftStream');

const TELEGRAM_STREAM_MAX_CHARS = 4096;
const DEFAULT_THROTTLE_MS = 1000;

export interface TelegramDraftStreamOptions {
  api: Bot['api'];
  chatId: number | string;
  maxChars?: number;
  threadId?: number;
  replyToMessageId?: number;
  throttleMs?: number;
  parseMode?: 'Markdown' | 'HTML' | undefined;
}

export interface TelegramDraftStream {
  update: (text: string) => void;
  flush: () => Promise<void>;
  messageId: () => number | undefined;
  clear: () => Promise<void>;
  stop: () => void;
  forceNewMessage: () => void;
}

/**
 * Create a draft stream for streaming message previews
 */
export function createTelegramDraftStream(
  options: TelegramDraftStreamOptions
): TelegramDraftStream {
  const maxChars = Math.min(
    options.maxChars ?? TELEGRAM_STREAM_MAX_CHARS,
    TELEGRAM_STREAM_MAX_CHARS
  );
  const throttleMs = Math.max(250, options.throttleMs ?? DEFAULT_THROTTLE_MS);
  const chatId = options.chatId;
  
  const threadParams: Record<string, number> = {};
  if (options.threadId) {
    threadParams.message_thread_id = options.threadId;
  }
  if (options.replyToMessageId) {
    threadParams.reply_to_message_id = options.replyToMessageId;
  }

  let streamMessageId: number | undefined;
  let lastSentText = '';
  let stopped = false;
  let pendingText = '';
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  const sendOrEditStreamMessage = async (text: string) => {
    if (stopped) {
      return;
    }

    const trimmed = text.trimEnd();
    if (!trimmed) {
      return;
    }

    if (trimmed.length > maxChars) {
      // Stop streaming once we exceed the cap
      stopped = true;
      log.warn(
        { chatId, textLength: trimmed.length, maxChars },
        'Stream preview stopped (text length exceeded limit)'
      );
      return;
    }

    if (trimmed === lastSentText) {
      return;
    }

    lastSentText = trimmed;

    try {
      if (typeof streamMessageId === 'number') {
        // Edit existing message
        await options.api.editMessageText(chatId, streamMessageId, trimmed, {
          parse_mode: options.parseMode,
        });
      } else {
        // Create new message
        const sent = await options.api.sendMessage(chatId, trimmed, {
          parse_mode: options.parseMode,
          ...threadParams,
        });
        const sentMessageId = sent?.message_id;
        if (typeof sentMessageId !== 'number' || !Number.isFinite(sentMessageId)) {
          stopped = true;
          log.warn({ chatId }, 'Stream preview stopped (missing message id)');
          return;
        }
        streamMessageId = Math.trunc(sentMessageId);
      }
    } catch (err) {
      stopped = true;
      log.error(
        { chatId, err: err instanceof Error ? err.message : String(err) },
        'Stream preview failed'
      );
    }
  };

  const scheduleUpdate = () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
    }

    pendingTimer = setTimeout(async () => {
      pendingTimer = null;
      if (pendingText) {
        await sendOrEditStreamMessage(pendingText);
        pendingText = '';
      }
    }, throttleMs);
  };

  const update = (text: string) => {
    if (stopped) {
      return;
    }

    pendingText = text;
    scheduleUpdate();
  };

  const flush = async () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }

    if (pendingText) {
      await sendOrEditStreamMessage(pendingText);
      pendingText = '';
    }
  };

  const clear = async () => {
    stop();
    await flush();

    const messageId = streamMessageId;
    streamMessageId = undefined;

    if (typeof messageId !== 'number') {
      return;
    }

    try {
      await options.api.deleteMessage(chatId, messageId);
    } catch (err) {
      log.warn(
        { chatId, messageId, err: err instanceof Error ? err.message : String(err) },
        'Stream preview cleanup failed'
      );
    }
  };

  const stop = () => {
    stopped = true;
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  const forceNewMessage = () => {
    streamMessageId = undefined;
    lastSentText = '';
    pendingText = '';
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  log.debug(
    { chatId, maxChars, throttleMs },
    'Draft stream created'
  );

  return {
    update,
    flush,
    messageId: () => streamMessageId,
    clear,
    stop,
    forceNewMessage,
  };
}

/**
 * Streaming state manager for tracking active streams per chat
 */
export class DraftStreamManager {
  private streams = new Map<string, TelegramDraftStream>();

  /**
   * Get or create a draft stream for a chat
   */
  getOrCreate(
    key: string,
    options: TelegramDraftStreamOptions
  ): TelegramDraftStream {
    const existing = this.streams.get(key);
    if (existing) {
      return existing;
    }

    const stream = createTelegramDraftStream(options);
    this.streams.set(key, stream);

    // Auto-cleanup when stream stops
    const originalStop = stream.stop;
    stream.stop = () => {
      originalStop.call(stream);
      this.streams.delete(key);
    };

    return stream;
  }

  /**
   * Get existing stream for a chat
   */
  get(key: string): TelegramDraftStream | undefined {
    return this.streams.get(key);
  }

  /**
   * Stop and cleanup stream for a chat
   */
  async stop(key: string): Promise<void> {
    const stream = this.streams.get(key);
    if (stream) {
      await stream.flush();
      stream.stop();
      this.streams.delete(key);
    }
  }

  /**
   * Stop all active streams
   */
  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [key, stream] of this.streams.entries()) {
      promises.push(
        (async () => {
          await stream.flush();
          stream.stop();
          this.streams.delete(key);
        })()
      );
    }
    await Promise.all(promises);
  }

  /**
   * Clear stream preview without stopping
   */
  async clear(key: string): Promise<void> {
    const stream = this.streams.get(key);
    if (stream) {
      await stream.clear();
    }
  }
}

// Export singleton instance
export const draftStreamManager = new DraftStreamManager();
