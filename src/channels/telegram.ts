import { Bot, GrammyError, HttpError, type Context, type NextFunction } from 'grammy';
import { run } from '@grammyjs/runner';
import { BaseChannel } from './base.js';
import { OutboundMessage } from '../types/index.js';
import { MessageBus } from '../bus/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TelegramChannel');

export class TelegramChannel extends BaseChannel {
  name = 'telegram';
  private bot: Bot | null = null;
  private runner: ReturnType<typeof run> | null = null;

  constructor(config: Record<string, unknown>, bus: MessageBus) {
    super(config, bus);
  }

  async start(): Promise<void> {
    if (this.running) return;

    const token = this.config.token as string;
    if (!token) {
      throw new Error('Telegram token not configured');
    }

    this.bot = new Bot(token);

    this.bot.use(this.allowListMiddleware.bind(this));

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

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.bot) {
      log.error('Telegram bot not initialized');
      return;
    }

    try {
      await this.bot.api.sendMessage(msg.chat_id, msg.content, {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      if (error instanceof GrammyError) {
        log.error({ description: error.description }, 'Telegram API error');

        try {
          await this.bot.api.sendMessage(msg.chat_id, msg.content);
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
