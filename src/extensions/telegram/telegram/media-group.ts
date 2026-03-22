/**
 * Media Group Buffer
 * 
 * Buffers and groups multiple media messages sent in quick succession.
 * Telegram sends each photo in an album as separate updates with the same media_group_id.
 * This module buffers them and processes as a single message with multiple attachments.
 */

import type { Context } from 'grammy';
import type { Message } from '@grammyjs/types';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('MediaGroupBuffer');

const DEFAULT_BUFFER_TIMEOUT_MS = 500; // Wait 500ms for all photos in group

export interface MediaGroupEntry {
  messages: Array<{
    msg: Message;
    ctx: Context;
    accountId: string;
    receivedAt: number;
  }>;
  timer: ReturnType<typeof setTimeout>;
}

export interface MediaGroupBufferOptions {
  /** Buffer timeout in milliseconds */
  timeoutMs?: number;
  /** Callback when a media group is ready to be processed */
  onFlush: (messages: Message[], ctx: Context, accountId: string) => Promise<void>;
}

export class MediaGroupBuffer {
  private buffer = new Map<string, MediaGroupEntry>();
  private timeoutMs: number;
  private onFlush: (messages: Message[], ctx: Context, accountId: string) => Promise<void>;
  private processing = Promise.resolve();

  constructor(options: MediaGroupBufferOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_BUFFER_TIMEOUT_MS;
    this.onFlush = options.onFlush;
  }

  /**
   * Process a message that might be part of a media group
   * Returns true if message was buffered (part of media group)
   * Returns false if message should be processed immediately
   */
  async process(ctx: Context, accountId: string): Promise<boolean> {
    const msg = ctx.message;
    if (!msg) return false;

    const mediaGroupId = (msg as { media_group_id?: string }).media_group_id;
    
    // Not part of a media group - process immediately
    if (!mediaGroupId) {
      return false;
    }

    const key = `${ctx.chat?.id}:${mediaGroupId}`;
    const existingEntry = this.buffer.get(key);

    if (existingEntry) {
      // Add to existing group
      existingEntry.messages.push({
        msg,
        ctx,
        accountId,
        receivedAt: Date.now(),
      });
      log.debug({ mediaGroupId, messageCount: existingEntry.messages.length }, 'Added to existing media group');
      return true;
    }

    // Create new group entry
    const timer = setTimeout(() => {
      void this.flushGroup(key);
    }, this.timeoutMs);

    this.buffer.set(key, {
      messages: [{ msg, ctx, accountId, receivedAt: Date.now() }],
      timer,
    });

    log.debug({ mediaGroupId, chatId: ctx.chat?.id }, 'Created new media group buffer');
    return true;
  }

  /**
   * Flush a specific media group
   */
  private async flushGroup(key: string): Promise<void> {
    const entry = this.buffer.get(key);
    if (!entry) return;

    this.buffer.delete(key);
    clearTimeout(entry.timer);

    if (entry.messages.length === 0) return;

    // Chain processing to ensure order
    this.processing = this.processing.then(async () => {
      try {
        const messages = entry.messages.map(m => m.msg);
        const firstCtx = entry.messages[0].ctx;
        const accountId = entry.messages[0].accountId;
        
        log.info({ 
          mediaGroupId: (messages[0] as { media_group_id?: string }).media_group_id,
          messageCount: messages.length 
        }, 'Flushing media group');

        await this.onFlush(messages, firstCtx, accountId);
      } catch (err) {
        log.error({ err, key }, 'Failed to flush media group');
      }
    });

    await this.processing;
  }

  /**
   * Flush all pending media groups (for shutdown)
   */
  async flushAll(): Promise<void> {
    const keys = Array.from(this.buffer.keys());
    await Promise.all(keys.map(key => this.flushGroup(key)));
  }

  /**
   * Get buffer statistics
   */
  getStats(): { 
    pendingGroups: number; 
    totalPendingMessages: number;
  } {
    let totalMessages = 0;
    for (const entry of this.buffer.values()) {
      totalMessages += entry.messages.length;
    }
    return {
      pendingGroups: this.buffer.size,
      totalPendingMessages: totalMessages,
    };
  }

  /**
   * Clear all pending groups without processing
   */
  clear(): void {
    for (const entry of this.buffer.values()) {
      clearTimeout(entry.timer);
    }
    this.buffer.clear();
    // Reset processing chain to prevent any pending flush operations
    this.processing = Promise.resolve();
  }
}
