import { BaseChannel } from './base.js';
import { TelegramChannel } from './telegram.js';
import { WhatsAppChannel } from './whatsapp.js';
import { MessageBus } from '../bus/index.js';
import { Config } from '../config/index.js';
import { OutboundMessage } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ChannelManager');

export class ChannelManager {
  private channels: Map<string, BaseChannel> = new Map();
  private bus: MessageBus;

  constructor(config: Config, bus: MessageBus) {
    this.bus = bus;

    // Initialize Telegram
    if (config.channels.telegram?.enabled) {
      const telegram = new TelegramChannel(config.channels.telegram, bus);
      this.channels.set('telegram', telegram);
    }

    // Initialize WhatsApp
    if (config.channels.whatsapp?.enabled) {
      const whatsapp = new WhatsAppChannel(config.channels.whatsapp, bus);
      this.channels.set('whatsapp', whatsapp);
    }
  }

  async startAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [name, channel] of this.channels) {
      if (!channel.isRunning) {
        log.info(`Starting ${name} channel...`);
        promises.push(channel.start().catch(err => {
          log.error({ err }, `Failed to start ${name} channel`);
        }));
      }
    }

    await Promise.all(promises);
  }

  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const channel of this.channels.values()) {
      if (channel.isRunning) {
        promises.push(channel.stop());
      }
    }

    await Promise.all(promises);
  }

  /**
   * Update channel configuration (hot reload)
   */
  updateConfig(config: Config): void {
    // Update Telegram config if enabled
    if (config.channels.telegram?.enabled) {
      const telegram = this.channels.get('telegram');
      if (telegram && 'updateConfig' in telegram) {
        (telegram as any).updateConfig(config.channels.telegram);
      } else {
        // Create new instance if not exists
        const newTelegram = new TelegramChannel(config.channels.telegram, this.bus);
        this.channels.set('telegram', newTelegram);
      }
    }

    // Update WhatsApp config if enabled
    if (config.channels.whatsapp?.enabled) {
      const whatsapp = this.channels.get('whatsapp');
      if (whatsapp && 'updateConfig' in whatsapp) {
        (whatsapp as any).updateConfig(config.channels.whatsapp);
      } else {
        // Create new instance if not exists
        const newWhatsApp = new WhatsAppChannel(config.channels.whatsapp, this.bus);
        this.channels.set('whatsapp', newWhatsApp);
      }
    }

    log.info('Channel config updated');
  }

  async send(msg: OutboundMessage): Promise<void> {
    const channel = this.channels.get(msg.channel);
    if (channel) {
      await channel.send(msg);
    } else {
      log.error({ channel: msg.channel }, `Unknown channel: ${msg.channel}`);
    }
  }

  getChannel(name: string): BaseChannel | undefined {
    return this.channels.get(name);
  }

  getRunningChannels(): string[] {
    return Array.from(this.channels.entries())
      .filter(([, channel]) => channel.isRunning)
      .map(([name]) => name);
  }

  getAllChannels(): string[] {
    return Array.from(this.channels.keys());
  }
}
