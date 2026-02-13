import { Bot, GrammyError, HttpError, InputFile, type Context, type NextFunction } from 'grammy';
import { run } from '@grammyjs/runner';
import { BaseChannel } from './base.js';
import { OutboundMessage } from '../types/index.js';
import { MessageBus } from '../bus/index.js';
import { createLogger } from '../utils/logger.js';
import { TypingController } from './typing-controller.js';

const log = createLogger('TelegramChannel');

export class TelegramChannel extends BaseChannel {
  name = 'telegram';
  private bot: Bot | null = null;
  private runner: ReturnType<typeof run> | null = null;
  private debug: boolean;
  private typingController: TypingController;

  constructor(config: Record<string, unknown>, bus: MessageBus) {
    super(config, bus);
    this.debug = (config.debug as boolean) ?? false;
    this.typingController = new TypingController(this.debug);
  }

  async start(): Promise<void> {
    if (this.running) return;

    const token = this.config.token as string;
    if (!token) {
      throw new Error('Telegram token not configured');
    }

    log.info({ apiRoot: this.config.apiRoot || 'https://api.telegram.org (default)' }, 'Initializing Telegram bot');

    const botConfig = this.config.apiRoot
      ? { client: { apiRoot: this.config.apiRoot as string } }
      : undefined;
    this.bot = new Bot(token, botConfig);

    this.bot.use(this.allowListMiddleware.bind(this));

    await this.bot.api.setMyCommands([
      { command: 'new', description: 'Start a new session' },
      { command: 'reset', description: 'Alias for /new' },
      { command: 'skills', description: 'Reload agent skills (e.g., /skills reload)' },
    ]);

    this.bot.on('message:text', async (ctx) => {
      const senderId = String(ctx.from?.id);
      const chatId = String(ctx.chat.id);
      const content = ctx.message.text || '';

      await this.handleMessage(senderId, chatId, content);
    });

    this.bot.on('message:photo', async (ctx) => {
      const photos = ctx.message.photo;
      const fileIds = photos.map((p) => p.file_id);
      const caption = ctx.message.caption || '[photo]';

      await this.handleMessage(
        String(ctx.from?.id),
        String(ctx.chat.id),
        caption,
        fileIds
      );
    });

    this.bot.on('message:document', async (ctx) => {
      const fileId = ctx.message.document?.file_id;
      const caption = ctx.message.caption || ctx.message.document?.file_name || '[document]';

      await this.handleMessage(
        String(ctx.from?.id),
        String(ctx.chat.id),
        caption,
        fileId ? [fileId] : undefined
      );
    });

    this.bot.catch((err) => {
      const ctx = err.ctx;
      log.error(`Error while handling update ${ctx.update.update_id}:`);

      const e = err.error;
      if (e instanceof GrammyError) {
        log.error({ description: e.description }, 'Grammy error');
      } else if (e instanceof HttpError) {
        log.error('HTTP error when contacting Telegram');
      } else {
        log.error({ err: e }, 'Unknown error');
      }
    });

    this.runner = run(this.bot);
    this.running = true;
    
    // 验证 API 连接
    try {
      const me = await this.bot.api.getMe();
      log.info({ username: me.username, apiRoot: this.config.apiRoot || 'default' }, 'Telegram API connection verified');
    } catch (err) {
      log.error({ err, apiRoot: this.config.apiRoot }, 'Failed to verify Telegram API connection');
      throw err;
    }
    
    log.info('Telegram channel started with Grammy');
  }

  private async allowListMiddleware(ctx: Context, next: NextFunction): Promise<void> {
    const senderId = String(ctx.from?.id);

    if (!this.isAllowed(senderId)) {
      log.debug({ senderId }, 'Message from unauthorized user ignored');
      return;
    }

    await next();
  }

  async stop(): Promise<void> {
    this.running = false;

    // Stop all typing indicators
    this.typingController.stopAll();

    if (this.runner) {
      await this.runner.stop();
      this.runner = null;
    }

    if (this.bot) {
      this.bot.stop();
      this.bot = null;
    }

    log.info('Telegram channel stopped');
  }

  /**
   * Test connection to Telegram API via getMe
   */
  async testConnection(): Promise<{ success: boolean; botInfo?: { id: number; username: string; first_name: string }; error?: string }> {
    if (!this.bot) {
      return { success: false, error: 'Bot not initialized' };
    }

    try {
      const me = await this.bot.api.getMe();
      log.info({ 
        id: me.id, 
        username: me.username, 
        first_name: me.first_name,
        apiRoot: this.config.apiRoot || 'default'
      }, 'getMe test successful');
      return { 
        success: true, 
        botInfo: { 
          id: me.id, 
          username: me.username, 
          first_name: me.first_name 
        } 
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error({ err, apiRoot: this.config.apiRoot }, 'getMe test failed');
      return { success: false, error: errorMsg };
    }
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.bot) {
      log.error('Telegram bot not initialized');
      return;
    }

    if (msg.type === 'typing_on') {
      try {
        await this.bot.api.sendChatAction(msg.chat_id, 'typing');
      } catch (error) {
        log.warn({ err: error }, 'Failed to send typing action');
      }
      return;
    }

    if (msg.type === 'typing_off') {
      // Telegram handles this automatically
      return;
    }

    if (this.debug) {
      log.debug({ chatId: msg.chat_id, contentLength: msg.content?.length }, 'Sending message');
    }

    // Stop typing before sending the actual message
    await this.typingController.stop(msg.chat_id);

    // Handle media sending
    if (msg.mediaUrl) {
      await this.sendMedia(msg);
      return;
    }

    // Regular text message
    await this.sendText(msg);
  }

  private async sendMedia(msg: OutboundMessage): Promise<void> {
    if (!this.bot || !msg.mediaUrl) return;

    try {
      const response = await fetch(msg.mediaUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      const mediaType = msg.mediaType || 'photo';
      const fileName = this.getFileName(mediaType, msg.mediaUrl);
      const file = new InputFile(Buffer.from(buffer), fileName);

      const caption = msg.content || undefined;
      const sendOptions: Record<string, unknown> = {
        parse_mode: 'Markdown',
      };

      switch (mediaType) {
        case 'photo':
          await this.bot.api.sendPhoto(msg.chat_id, file, { ...sendOptions, caption });
          break;
        case 'video':
          await this.bot.api.sendVideo(msg.chat_id, file, { ...sendOptions, caption });
          break;
        case 'audio':
          await this.bot.api.sendAudio(msg.chat_id, file, { ...sendOptions, caption });
          break;
        case 'animation':
          await this.bot.api.sendAnimation(msg.chat_id, file, { ...sendOptions, caption });
          break;
        case 'document':
        default:
          await this.bot.api.sendDocument(msg.chat_id, file, { ...sendOptions, caption });
          break;
      }

      if (this.debug) {
        log.debug({ chatId: msg.chat_id, mediaType }, 'Media sent successfully');
      }
    } catch (error) {
      log.error({ err: error, mediaType: msg.mediaType }, 'Failed to send media');
      // Fallback to text if media fails
      await this.sendText(msg);
    }
  }

  private getFileName(mediaType: string, url: string): string {
    const extension = {
      photo: 'jpg',
      video: 'mp4',
      audio: 'mp3',
      animation: 'gif',
      document: 'bin',
    }[mediaType] || 'bin';

    // Try to extract filename from URL
    const urlParts = url.split('/');
    const urlFileName = urlParts[urlParts.length - 1];
    const queryIndex = urlFileName.indexOf('?');
    if (queryIndex > 0) {
      return urlFileName.substring(0, queryIndex);
    }

    // If URL has a proper extension, use it
    if (urlFileName && urlFileName.includes('.')) {
      return urlFileName;
    }

    return `file.${extension}`;
  }

  private async sendText(msg: OutboundMessage): Promise<void> {
    if (!this.bot) return;

    try {
      await this.bot.api.sendMessage(msg.chat_id, msg.content || '', {
        parse_mode: 'Markdown',
      });
      if (this.debug) {
        log.debug({ chatId: msg.chat_id }, 'Message sent successfully');
      }
    } catch (error) {
      if (error instanceof GrammyError) {
        log.error({ description: error.description }, 'Telegram API error');

        try {
          // Try to send plain text without markdown
          await this.bot.api.sendMessage(msg.chat_id, msg.content || '');
        } catch {
          log.error('Failed to send plain text message');
        }
      } else if (error instanceof HttpError) {
        log.error('HTTP error');
      } else {
        log.error({ err: error }, 'Failed to send message');
      }
    }
  }

  async react(chatId: string, messageId: number, emoji: string): Promise<void> {
    if (!this.bot) return;

    try {
      await this.bot.api.setMessageReaction(chatId, messageId, [
        { type: 'emoji', emoji: emoji as '👍' },
      ]);
    } catch (error) {
      log.error({ err: error }, 'Failed to set reaction');
    }
  }
}
