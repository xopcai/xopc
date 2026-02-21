/**
 * Telegram Bot Client Wrapper
 */

import { Bot, InputFile } from 'grammy';
import { run } from '@grammyjs/runner';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('TelegramClient');

export interface TelegramClientConfig {
  token: string;
  apiRoot?: string;
  debug?: boolean;
}

export interface SendOptions {
  chatId: string;
  content?: string;
  mediaUrl?: string;
  mediaType?: 'photo' | 'video' | 'audio' | 'animation' | 'document';
  threadId?: string;
  replyToMessageId?: string;
  silent?: boolean;
  parseMode?: 'Markdown' | 'HTML';
}

export class TelegramClient {
  private bot: Bot | null = null;
  private runner: ReturnType<typeof run> | null = null;
  private debug: boolean;
  private apiRoot?: string;
  private username: string | null = null;

  constructor(config: TelegramClientConfig) {
    this.debug = config.debug ?? false;
    this.apiRoot = config.apiRoot;
  }

  async init(): Promise<string> {
    const botConfig = this.apiRoot 
      ? { client: { apiRoot: this.apiRoot } } 
      : undefined;
    
    this.bot = new Bot(this.config.token, botConfig);
    const me = await this.bot.api.getMe();
    this.username = me.username ?? null;
    
    log.info({ username: this.username, apiRoot: this.apiRoot }, 'Telegram client initialized');
    return this.username!;
  }

  get botInstance(): Bot | null {
    return this.bot;
  }

  get botUsername(): string | null {
    return this.username;
  }

  get isInitialized(): boolean {
    return this.bot !== null;
  }

  start(): void {
    if (!this.bot) {
      throw new Error('Bot not initialized');
    }
    this.runner = run(this.bot);
    log.info('Telegram client started');
  }

  async stop(): Promise<void> {
    if (this.runner) {
      await this.runner.stop();
      this.runner = null;
    }
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
    }
    log.info('Telegram client stopped');
  }

  async send(options: SendOptions): Promise<number> {
    if (!this.bot) {
      throw new Error('Bot not initialized');
    }

    const { chatId, content, mediaUrl, mediaType, threadId, replyToMessageId, silent, parseMode } = options;

    // Handle typing indicator
    if (content === '__typing__') {
      await this.bot.api.sendChatAction(chatId, 'typing');
      return 0;
    }

    // Send media
    if (mediaUrl) {
      return this.sendMedia({ chatId, mediaUrl, mediaType, content, threadId, replyToMessageId, silent, parseMode });
    }

    // Send text
    return this.sendText({ chatId, content: content || '', threadId, replyToMessageId, silent, parseMode });
  }

  private async sendMedia(options: SendOptions): Promise<number> {
    if (!this.bot || !options.mediaUrl) {
      throw new Error('Bot or mediaUrl not initialized');
    }

    const response = await fetch(options.mediaUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const file = new InputFile(Buffer.from(buffer), this.getFileName(options.mediaType, options.mediaUrl));

    const sendOptions: Record<string, unknown> = {
      parse_mode: options.parseMode || 'Markdown',
    };

    if (options.threadId) sendOptions.message_thread_id = parseInt(options.threadId, 10);
    if (options.replyToMessageId) sendOptions.reply_to_message_id = parseInt(options.replyToMessageId, 10);
    if (options.silent) sendOptions.disable_notification = true;

    let result;
    switch (options.mediaType) {
      case 'photo':
        result = await this.bot.api.sendPhoto(options.chatId, file, { ...sendOptions, caption: options.content });
        break;
      case 'video':
        result = await this.bot.api.sendVideo(options.chatId, file, { ...sendOptions, caption: options.content });
        break;
      case 'audio':
        result = await this.bot.api.sendAudio(options.chatId, file, { ...sendOptions, caption: options.content });
        break;
      case 'animation':
        result = await this.bot.api.sendAnimation(options.chatId, file, { ...sendOptions, caption: options.content });
        break;
      default:
        result = await this.bot.api.sendDocument(options.chatId, file, { ...sendOptions, caption: options.content });
    }

    return result.message_id;
  }

  private async sendText(options: Omit<SendOptions, 'mediaUrl' | 'mediaType'>): Promise<number> {
    if (!this.bot) {
      throw new Error('Bot not initialized');
    }

    const sendOptions: Record<string, unknown> = {
      parse_mode: options.parseMode || 'Markdown',
    };

    if (options.threadId) sendOptions.message_thread_id = parseInt(options.threadId, 10);
    if (options.replyToMessageId) sendOptions.reply_to_message_id = parseInt(options.replyToMessageId, 10);
    if (options.silent) sendOptions.disable_notification = true;

    try {
      const result = await this.bot.api.sendMessage(options.chatId, options.content, sendOptions);
      return result.message_id;
    } catch (error: any) {
      // Try plain text on Markdown error
      if (error.description?.includes('Parse')) {
        delete sendOptions.parse_mode;
        const result = await this.bot.api.sendMessage(options.chatId, options.content, sendOptions);
        return result.message_id;
      }
      throw error;
    }
  }

  private getFileName(mediaType: string | undefined, url: string): string {
    const extension = {
      photo: 'jpg',
      video: 'mp4',
      audio: 'mp3',
      animation: 'gif',
      document: 'bin',
    }[mediaType || 'document'] || 'bin';

    const urlParts = url.split('/');
    const urlFileName = urlParts[urlParts.length - 1];
    const queryIndex = urlFileName.indexOf('?');
    if (queryIndex > 0) return urlFileName.substring(0, queryIndex);
    if (urlFileName.includes('.')) return urlFileName;

    return `file.${extension}`;
  }

  async testConnection(): Promise<{ success: boolean; botInfo?: { id: number; username: string; first_name: string }; error?: string }> {
    if (!this.bot) {
      return { success: false, error: 'Bot not initialized' };
    }

    try {
      const me = await this.bot.api.getMe();
      return { 
        success: true, 
        botInfo: { id: me.id, username: me.username, first_name: me.first_name } 
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private get config(): { token: string; apiRoot?: string } {
    // Access via getter to avoid storing sensitive config
    return { token: '', apiRoot: this.apiRoot };
  }

  setConfig(token: string): void {
    Object.defineProperty(this, 'config', { value: { token, apiRoot: this.apiRoot }, writable: false });
  }
}
