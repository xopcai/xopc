import TelegramBot from 'node-telegram-bot-api';
import { BaseChannel } from './base.js';
import { OutboundMessage } from '../types/index.js';
import { MessageBus } from '../bus/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TelegramChannel');

export class TelegramChannel extends BaseChannel {
  name = 'telegram';
  private bot: TelegramBot | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Record<string, unknown>, bus: MessageBus) {
    super(config, bus);
  }

  async start(): Promise<void> {
    if (this.running) return;

    const token = this.config.token as string;
    if (!token) {
      throw new Error('Telegram token not configured');
    }

    // Create bot
    this.bot = new TelegramBot(token, { polling: true });

    // Handle messages
    this.bot.on('message', async (msg) => {
      if (!msg.text && !msg.photo) return;
      
      const chatId = msg.chat.id;
      const senderId = String(msg.from?.id);
      const content = msg.text || '[media]';
      const media = msg.photo?.map(p => p.file_id) || [];

      await this.handleMessage(senderId, String(chatId), content, media.length > 0 ? media : undefined);
    });

    this.running = true;
    log.info('Telegram channel started');
  }

  async stop(): Promise<void> {
    this.running = false;
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.bot) {
      this.bot.stopPolling();
      this.bot = null;
    }

    log.info('Telegram channel stopped');
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.bot) {
      log.error('Telegram bot not initialized');
      return;
    }

    try {
      await this.bot.sendMessage(msg.chat_id, msg.content, {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      log.error({ err: error }, 'Failed to send Telegram message');
      // Try without markdown if it fails
      try {
        await this.bot?.sendMessage(msg.chat_id, msg.content);
      } catch {
        log.error('Failed to send Telegram message (plain text)');
      }
    }
  }
}
