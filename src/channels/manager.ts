/**
 * Channel Manager
 * 
 * Manages all channel plugins.
 */

import { telegramPlugin } from './telegram/plugin.js';
import { whatsappPlugin } from './whatsapp/plugin.js';
import type { ChannelPlugin } from './types.js';
import { MessageBus } from '../bus/index.js';
import { Config } from '../config/index.js';
import { OutboundMessage } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ChannelManager');

const PLUGINS: ChannelPlugin[] = [telegramPlugin, whatsappPlugin];

export class ChannelManager {
  private bus: MessageBus;
  private config: Config;
  private initialized = false;

  constructor(config: Config, bus: MessageBus) {
    this.bus = bus;
    this.config = config;
  }

  async initializePlugins(): Promise<void> {
    if (this.initialized) return;

    for (const plugin of PLUGINS) {
      const channelConfig = this.config.channels?.[plugin.id];
      if (channelConfig?.enabled) {
        try {
          await plugin.init({
            bus: this.bus,
            config: this.config,
            channelConfig,
          });
          log.info({ channel: plugin.id }, 'Channel plugin initialized');
        } catch (err) {
          log.error({ channel: plugin.id, err }, 'Failed to initialize channel plugin');
        }
      }
    }

    this.initialized = true;
  }

  async startAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const plugin of PLUGINS) {
      const channelConfig = this.config.channels?.[plugin.id];
      if (channelConfig?.enabled) {
        promises.push(
          plugin.start().catch(err => {
            log.error({ channel: plugin.id, err }, 'Failed to start channel plugin');
          })
        );
      }
    }

    await Promise.all(promises);
  }

  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const plugin of PLUGINS) {
      const channelConfig = this.config.channels?.[plugin.id];
      if (channelConfig?.enabled) {
        promises.push(
          plugin.stop().catch(err => {
            log.error({ channel: plugin.id, err }, 'Failed to stop channel plugin');
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
    const plugin = PLUGINS.find(p => p.id === msg.channel);
    
    if (!plugin) {
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
    };

    const result = await plugin.send(sendOptions);
    
    if (!result.success) {
      log.error({ channel: msg.channel, error: result.error }, 'Failed to send message');
    }
  }

  getChannel(name: string): any {
    const plugin = PLUGINS.find(p => p.id === name);
    return plugin || null;
  }

  getStatus(channelName: string, accountId?: string) {
    const plugin = PLUGINS.find(p => p.id === channelName);
    
    if (plugin) {
      return plugin.getStatus(accountId);
    }

    return {
      running: false,
      mode: 'unknown',
    };
  }

  getRunningChannels(): string[] {
    return PLUGINS
      .filter(p => this.config.channels?.[p.id]?.enabled)
      .map(p => p.id);
  }

  getAllChannels(): string[] {
    return PLUGINS.map(p => p.id);
  }

  async testConnections(): Promise<Record<string, { success: boolean; error?: string }>> {
    const results: Record<string, { success: boolean; error?: string }> = {};

    for (const plugin of PLUGINS) {
      const channelConfig = this.config.channels?.[plugin.id];
      if (channelConfig?.enabled) {
        results[plugin.id] = await plugin.testConnection();
      }
    }

    return results;
  }
}
