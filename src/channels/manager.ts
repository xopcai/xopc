/**
 * Channel Manager
 * 
 * Manages all channel implementations.
 */

import { telegramExtension } from './telegram/extension.js';
import type { ChannelExtension, ChannelStreamHandle } from './types.js';
import { MessageBus } from '../bus/index.js';
import { Config } from '../config/index.js';
import { OutboundMessage } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ChannelManager');

const EXTENSIONS: ChannelExtension[] = [telegramExtension];

export class ChannelManager {
  private bus: MessageBus;
  private config: Config;
  private initialized = false;

  constructor(config: Config, bus: MessageBus) {
    this.bus = bus;
    this.config = config;
  }

  async initializeChannels(): Promise<void> {
    if (this.initialized) return;

    for (const extension of EXTENSIONS) {
      const channelConfig = this.config.channels?.[extension.id];
      if (channelConfig?.enabled) {
        try {
          await extension.init({
            bus: this.bus,
            config: this.config,
            channelConfig,
          });
          log.info({ channel: extension.id }, 'Channel initialized');
        } catch (err) {
          log.error({ channel: extension.id, err }, 'Failed to initialize channel');
        }
      }
    }

    this.initialized = true;
  }

  async startAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const extension of EXTENSIONS) {
      const channelConfig = this.config.channels?.[extension.id];
      if (channelConfig?.enabled) {
        promises.push(
          extension.start().catch(err => {
            log.error({ channel: extension.id, err }, 'Failed to start channel');
          })
        );
      }
    }

    await Promise.all(promises);
  }

  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const extension of EXTENSIONS) {
      const channelConfig = this.config.channels?.[extension.id];
      if (channelConfig?.enabled) {
        promises.push(
          extension.stop().catch(err => {
            log.error({ channel: extension.id, err }, 'Failed to stop channel');
          })
        );
      }
    }

    await Promise.all(promises);
  }

  updateConfig(config: Config): void {
    this.config = config;
    log.info('Channel config updated');
  }

  async send(msg: OutboundMessage): Promise<void> {
    const extension = EXTENSIONS.find(e => e.id === msg.channel);
    
    if (!extension) {
      log.error({ channel: msg.channel }, 'Unknown channel');
      return;
    }

    const sendOptions = {
      chatId: msg.chat_id,
      content: msg.content || '',
      type: msg.type,
      accountId: msg.metadata?.accountId ? String(msg.metadata.accountId) : undefined,
      threadId: msg.metadata?.threadId ? String(msg.metadata.threadId) : undefined,
      replyToMessageId: msg.metadata?.replyToMessageId ? String(msg.metadata.replyToMessageId) : undefined,
      mediaUrl: msg.mediaUrl,
      mediaType: msg.mediaType,
      tts: msg.tts,
    };

    const result = await extension.send(sendOptions);
    
    if (!result.success) {
      log.error({ channel: msg.channel, chatId: msg.chat_id, mediaUrl: !!msg.mediaUrl, error: result.error }, 'Failed to send message');
    } else {
      log.info({ channel: msg.channel, chatId: msg.chat_id, messageId: result.messageId, mediaUrl: !!msg.mediaUrl }, 'Message sent successfully');
    }
  }

  /**
   * Start a streaming message for real-time updates
   * Returns a handle for updating the stream
   */
  startStream(channel: string, chatId: string, accountId?: string): ChannelStreamHandle | null {
    const extension = EXTENSIONS.find(e => e.id === channel);
    
    if (!extension) {
      log.error({ channel }, 'Unknown channel for streaming');
      return null;
    }

    return extension.startStream({
      chatId: String(chatId),
      accountId,
    });
  }

  getChannel(name: string): any {
    const extension = EXTENSIONS.find(e => e.id === name);
    return extension || null;
  }

  getStatus(channelName: string, accountId?: string) {
    const extension = EXTENSIONS.find(e => e.id === channelName);
    
    if (extension) {
      return extension.getStatus(accountId);
    }

    return {
      running: false,
      mode: 'unknown',
    };
  }

  getRunningChannels(): string[] {
    return EXTENSIONS
      .filter(e => this.config.channels?.[e.id]?.enabled)
      .map(e => e.id);
  }

  getAllChannels(): string[] {
    return EXTENSIONS.map(e => e.id);
  }

  async testConnections(): Promise<Record<string, { success: boolean; error?: string }>> {
    const results: Record<string, { success: boolean; error?: string }> = {};

    for (const extension of EXTENSIONS) {
      const channelConfig = this.config.channels?.[extension.id];
      if (channelConfig?.enabled) {
        results[extension.id] = await extension.testConnection();
      }
    }

    return results;
  }
}
