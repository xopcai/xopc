/**
 * Channel Manager
 *
 * Manages all channel implementations.
 * TTS is applied at the dispatch layer via maybeApplyTtsToPayload.
 */

import { telegramExtension } from './telegram/extension.js';
import type { ChannelExtension, ChannelStreamHandle } from './types.js';
import { MessageBus } from '../bus/index.js';
import { Config } from '../config/index.js';
import { OutboundMessage } from '../types/index.js';
import { maybeApplyTtsToPayload } from '../tts/payload.js';
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
    const processedMsg = await this.applyTtsIfNeeded(msg);

    const extension = EXTENSIONS.find(e => e.id === processedMsg.channel);
    if (!extension) {
      log.error({ channel: processedMsg.channel }, 'Unknown channel');
      return;
    }

    const sendOptions = {
      chatId: processedMsg.chat_id,
      content: processedMsg.content || '',
      type: processedMsg.type,
      accountId: processedMsg.metadata?.accountId ? String(processedMsg.metadata.accountId) : undefined,
      threadId: processedMsg.metadata?.threadId ? String(processedMsg.metadata.threadId) : undefined,
      replyToMessageId: processedMsg.replyToMessageId,
      mediaUrl: processedMsg.mediaUrl,
      mediaType: processedMsg.mediaType,
      audioAsVoice: processedMsg.audioAsVoice,
      silent: processedMsg.silent,
    };

    const result = await extension.send(sendOptions);

    if (!result.success) {
      log.error({ channel: processedMsg.channel, chatId: processedMsg.chat_id, mediaUrl: !!processedMsg.mediaUrl, error: result.error }, 'Failed to send message');
    } else {
      log.info({ channel: processedMsg.channel, chatId: processedMsg.chat_id, messageId: result.messageId, mediaUrl: !!processedMsg.mediaUrl, audioAsVoice: processedMsg.audioAsVoice }, 'Message sent successfully');
    }
  }

  private async applyTtsIfNeeded(msg: OutboundMessage): Promise<OutboundMessage> {
    if (msg.type && msg.type !== 'message') return msg;
    if (!msg.content?.trim()) return msg;
    if (msg.mediaUrl) return msg;

    const ttsConfig = this.config.tts || {
      enabled: false,
      provider: 'openai' as const,
      trigger: 'always' as const,
    };

    if (!ttsConfig.enabled) return msg;

    const inboundAudio = msg.metadata?.transcribedVoice === true;

    return maybeApplyTtsToPayload(msg, {
      config: ttsConfig,
      channel: msg.channel,
      inboundAudio,
    });
  }

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
    return { running: false, mode: 'unknown' };
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
