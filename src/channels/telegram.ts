import { Bot, GrammyError, HttpError, InputFile, type Context, type NextFunction, InlineKeyboard } from 'grammy';
import { run } from '@grammyjs/runner';
import { BaseChannel } from './base.js';
import { OutboundMessage } from '../types/index.js';
import { MessageBus } from '../bus/index.js';
import { createLogger } from '../utils/logger.js';
import { TypingController } from './typing-controller.js';
import { getApiKey } from '../config/schema.js';
import type { Config } from '../config/index.js';
import { createCallbackRegistry } from './telegram-handlers.js';

const log = createLogger('TelegramChannel');

// Model info interface
interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

export class TelegramChannel extends BaseChannel {
  name = 'telegram';
  private bot: Bot | null = null;
  private runner: ReturnType<typeof run> | null = null;
  private debug: boolean;
  private typingController: TypingController;
  private appConfig: Config;
  private sessionModels: Map<string, string> = new Map(); // sessionKey -> modelId
  private botUsername: string | null = null;

  constructor(config: Record<string, unknown>, bus: MessageBus, appConfig: Config) {
    super(config, bus);
    this.debug = (config.debug as boolean) ?? false;
    this.typingController = new TypingController(this.debug);
    this.appConfig = appConfig;
  }

  async start(): Promise<void> {
    if (this.running) return;

    const token = this.config.token as string;
    if (!token) {
      throw new Error('Telegram token not configured');
    }

    log.info({ apiRoot: (this.config as any).apiRoot || 'https://api.telegram.org (default)' }, 'Initializing Telegram bot');

    const botConfig = (this.config as any).apiRoot
      ? { client: { apiRoot: (this.config as any).apiRoot as string } }
      : undefined;
    this.bot = new Bot(token, botConfig);

    this.bot.use(this.allowListMiddleware.bind(this));

    await this.bot.api.setMyCommands([
      { command: 'new', description: 'Start a new session' },
      { command: 'reset', description: 'Alias for /new' },
      { command: 'models', description: 'Switch AI model' },
      { command: 'usage', description: 'Show token usage stats' },
      { command: 'cleanup', description: 'Archive old sessions' },
    ]);

    // Handle commands
    this.bot.command('models', async (ctx) => {
      await this.showModelSelector(ctx);
    });

    this.bot.command('usage', async (ctx) => {
      await this.showUsageStats(ctx);
    });

    this.bot.command('cleanup', async (ctx) => {
      await this.handleCleanup(ctx);
    });

    // Setup callback query handler registry
    const callbackRegistry = createCallbackRegistry({
      onModelSelect: async (ctx, modelId) => {
        await this.handleModelSelection(ctx, modelId);
      },
      onProviderSelect: async (ctx, providerId) => {
        await this.handleProviderSelection(ctx, providerId);
      },
      onShowProviders: async (ctx) => {
        await this.showProvidersAgain(ctx);
      },
      onCleanupConfirm: async (ctx) => {
        await this.handleCleanupConfirm(ctx);
      },
      onCancel: async (ctx) => {
        await ctx.editMessageText('Cancelled.');
        await ctx.answerCallbackQuery();
      },
    });

    // Handle callback queries (inline keyboard)
    this.bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      await callbackRegistry.route(ctx, data);
    });

    this.bot.on('message:text', async (ctx) => {
      const senderId = String(ctx.from?.id);
      const chatId = String(ctx.chat.id);
      const content = ctx.message.text || '';

      // Check if this is a group message and if bot is mentioned
      if (!this.shouldProcessGroupMessage(ctx, content)) {
        return;
      }

      // Remove bot mention from content for cleaner processing
      const cleanContent = this.removeBotMention(content);

      await this.handleMessage(senderId, chatId, cleanContent);
    });

    this.bot.on('message:photo', async (ctx) => {
      const photos = ctx.message.photo;
      const fileIds = photos.map((p) => p.file_id);
      const caption = ctx.message.caption || '[photo]';

      // Check if this is a group message and if bot is mentioned
      if (!this.shouldProcessGroupMessage(ctx, ctx.message.caption)) {
        return;
      }

      // Remove bot mention from caption for cleaner processing
      const cleanCaption = this.removeBotMention(caption);

      await this.handleMessage(
        String(ctx.from?.id),
        String(ctx.chat.id),
        cleanCaption,
        fileIds
      );
    });

    this.bot.on('message:document', async (ctx) => {
      const fileId = ctx.message.document?.file_id;
      const caption = ctx.message.caption || ctx.message.document?.file_name || '[document]';

      // Check if this is a group message and if bot is mentioned
      if (!this.shouldProcessGroupMessage(ctx, ctx.message.caption)) {
        return;
      }

      // Remove bot mention from caption for cleaner processing
      const cleanCaption = this.removeBotMention(caption);

      await this.handleMessage(
        String(ctx.from?.id),
        String(ctx.chat.id),
        cleanCaption,
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
    
    // 验证 API 连接并获取 bot 信息
    try {
      const me = await this.bot.api.getMe();
      this.botUsername = me.username ?? null;
      log.info({ username: me.username, apiRoot: (this.config as any).apiRoot || 'default' }, 'Telegram API connection verified');
    } catch (err) {
      log.error({ err, apiRoot: (this.config as any).apiRoot }, 'Failed to verify Telegram API connection');
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

  /**
   * Check if a group message should be processed.
   * In groups, only process messages that mention the bot.
   * Private chats are always processed.
   */
  private shouldProcessGroupMessage(ctx: Context, text?: string): boolean {
    const chatType = ctx.chat?.type;

    // Private chats are always processed
    if (chatType === 'private') {
      return true;
    }

    // In groups/supergroups, only process if bot is mentioned
    if (chatType === 'group' || chatType === 'supergroup') {
      if (!this.botUsername) {
        log.warn('Bot username not available, skipping group message');
        return false;
      }

      const messageText = text ?? '';
      return this.hasBotMention(ctx.message, messageText);
    }

    // Channel messages are not processed
    return false;
  }

  /**
   * Check if the message contains a mention of the bot.
   * Supports both text mentions and entity-based mentions.
   */
  private hasBotMention(message: any, text: string): boolean {
    if (!this.botUsername) return false;

    const botUsernameLower = this.botUsername.toLowerCase();
    const textLower = text.toLowerCase();

    // Check simple text mention: @botUsername
    if (textLower.includes(`@${botUsernameLower}`)) {
      return true;
    }

    // Check entity-based mentions (Telegram's mention entities)
    const entities = message?.entities ?? message?.caption_entities ?? [];
    for (const ent of entities) {
      if (ent.type === 'mention') {
        const mentionText = text.slice(ent.offset, ent.offset + ent.length);
        if (mentionText.toLowerCase() === `@${botUsernameLower}`) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Remove bot mention from text for cleaner processing.
   */
  private removeBotMention(text: string): string {
    if (!this.botUsername) return text;

    const botUsernameLower = this.botUsername.toLowerCase();
    // Remove @botUsername from text
    return text.replace(new RegExp(`@${botUsernameLower}\\s*`, 'gi'), '').trim();
  }

  // ========== Model Selection ==========

  private async showModelSelector(ctx: Context): Promise<void> {
    try {
      const providers = this.getAvailableProviders();

      if (providers.length === 0) {
        await ctx.reply('❌ No providers available. Please check your configuration.');
        return;
      }

      const keyboard = new InlineKeyboard();
      
      for (const provider of providers) {
        keyboard.text(provider.name, `provider:${provider.id}`).row();
      }

      keyboard.text('❌ Cancel', 'cancel');

      await ctx.reply('🤖 Select a provider:', { reply_markup: keyboard });
    } catch (err) {
      log.error({ err }, 'Failed to show provider selector');
      await ctx.reply('❌ Failed to load providers. Please try again.');
    }
  }

  private async showProviderModels(ctx: Context, providerId: string): Promise<void> {
    try {
      const chatId = String(ctx.chat?.id);
      const sessionKey = `telegram:${chatId}`;
      const currentModel = this.sessionModels.get(sessionKey) || this.appConfig.agents?.defaults?.model || 'anthropic/claude-sonnet-4-5';

      const models = this.getModelsForProvider(providerId);
      
      if (models.length === 0) {
        await ctx.editMessageText('❌ No models available for this provider.');
        await ctx.answerCallbackQuery();
        return;
      }

      const keyboard = new InlineKeyboard();
      
      for (const model of models) {
        const isCurrent = model.id === currentModel;
        const label = isCurrent ? `✅ ${model.name}` : model.name;
        keyboard.text(label, `model:${model.id}`).row();
      }

      keyboard.text('⬅️ Back', 'providers').row();
      keyboard.text('❌ Cancel', 'cancel');

      const providerName = this.getProviderDisplayName(providerId);
      await ctx.editMessageText(`🤖 Select a model from *${providerName}*:`, { 
        reply_markup: keyboard,
        parse_mode: 'Markdown',
      });
      await ctx.answerCallbackQuery();
    } catch (err) {
      log.error({ err, providerId }, 'Failed to show provider models');
      await ctx.answerCallbackQuery('Failed to load models');
    }
  }

  private async handleModelSelection(ctx: Context, modelId: string): Promise<void> {
    try {
      const chatId = String(ctx.chat?.id);
      const sessionKey = `telegram:${chatId}`;

      // Save the selected model for this session
      this.sessionModels.set(sessionKey, modelId);

      // Extract model name for display
      const modelName = modelId.split('/').pop() || modelId;

      await ctx.editMessageText(`✅ Model switched to *${modelName}*\n\nThis model will be used for your next message.`, {
        parse_mode: 'Markdown',
      });
      await ctx.answerCallbackQuery(`Switched to ${modelName}`);

      log.info({ sessionKey, modelId }, 'Model switched via Telegram');
    } catch (err) {
      log.error({ err }, 'Failed to handle model selection');
      await ctx.answerCallbackQuery('Failed to switch model');
    }
  }

  private async handleProviderSelection(ctx: Context, providerId: string): Promise<void> {
    try {
      await this.showProviderModels(ctx, providerId);
    } catch (err) {
      log.error({ err }, 'Failed to handle provider selection');
      await ctx.answerCallbackQuery('Failed to select provider');
    }
  }

  private async showProvidersAgain(ctx: Context): Promise<void> {
    try {
      const providers = this.getAvailableProviders();

      const keyboard = new InlineKeyboard();
      
      for (const provider of providers) {
        keyboard.text(provider.name, `provider:${provider.id}`).row();
      }

      keyboard.text('❌ Cancel', 'cancel');

      await ctx.editMessageText('🤖 Select a provider:', { reply_markup: keyboard });
      await ctx.answerCallbackQuery();
    } catch (err) {
      log.error({ err }, 'Failed to show providers again');
      await ctx.answerCallbackQuery('Failed to go back');
    }
  }

  private getAvailableModels(): ModelInfo[] {
    const models: ModelInfo[] = [];
    const providers = this.appConfig.providers || {};

    // Helper to add models from provider
    const addModels = (providerName: string, providerConfig: any) => {
      // Use getApiKey to check both config and environment variables
      const apiKey = getApiKey(this.appConfig, providerName);
      if (!apiKey) return;
      
      const modelList = providerConfig?.models || this.getDefaultModelsForProvider(providerName);
      for (const modelId of modelList) {
        models.push({
          id: `${providerName}/${modelId}`,
          name: modelId,
          provider: providerName,
        });
      }
    };

    // Check all providers
    for (const [name, config] of Object.entries(providers)) {
      addModels(name, config);
    }

    // Fallback: if no models found, add some defaults
    if (models.length === 0) {
      models.push(
        { id: 'minimax/MiniMax-M2.5', name: 'MiniMax-M2.5', provider: 'minimax' },
        { id: 'kimi-coding/k2p5', name: 'Kimi K2.5', provider: 'kimi' },
      );
    }

    return models;
  }

  private getDefaultModelsForProvider(provider: string): string[] {
    const defaults: Record<string, string[]> = {
      openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-5', 'o1', 'o3'],
      anthropic: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5'],
      google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
      qwen: ['qwen-plus', 'qwen-max', 'qwen3-235b'],
      kimi: ['kimi-k2.5', 'kimi-k2-thinking'],
      minimax: ['minimax-m2.5', 'minimax-m2.1', 'minimax-m2'],
      'minimax-cn': ['minimax-m2.1', 'minimax-m2'],
      zhipu: ['glm-4', 'glm-4-flash', 'glm-4-plus', 'glm-5', 'glm-5-flash'],
      'zhipu-cn': ['glm-4', 'glm-4-flash', 'glm-4-plus', 'glm-5', 'glm-5-flash'],
      deepseek: ['deepseek-chat', 'deepseek-reasoner'],
      groq: ['llama-3.3-70b', 'mixtral-8x7b'],
      openrouter: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet'],
      xai: ['grok-2'],
    };
    return defaults[provider] || ['default'];
  }

  private getProviderDisplayName(provider: string): string {
    const names: Record<string, string> = {
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      google: 'Google',
      qwen: 'Qwen (通义千问)',
      kimi: 'Kimi (月之暗面)',
      minimax: 'MiniMax (海外)',
      'minimax-cn': 'MiniMax CN (国内)',
      zhipu: 'Zhipu (智谱)',
      'zhipu-cn': 'Zhipu CN (国内)',
      deepseek: 'DeepSeek',
      groq: 'Groq',
      openrouter: 'OpenRouter',
      xai: 'xAI (Grok)',
      ollama: 'Ollama (本地)',
    };
    return names[provider] || provider;
  }

  private getAvailableProviders(): Array<{ id: string; name: string }> {
    const providers = this.appConfig.providers || {};
    const available: Array<{ id: string; name: string }> = [];

    for (const [name, _config] of Object.entries(providers)) {
      // Use getApiKey to check both config and environment variables
      const apiKey = getApiKey(this.appConfig, name);
      if (apiKey) {
        available.push({
          id: name,
          name: this.getProviderDisplayName(name),
        });
      }
    }

    return available;
  }

  private getModelsForProvider(providerId: string): ModelInfo[] {
    const models: ModelInfo[] = [];
    const providerConfig = (this.appConfig.providers as any)?.[providerId];
    
    const modelList = providerConfig?.models || this.getDefaultModelsForProvider(providerId);
    
    for (const modelId of modelList) {
      models.push({
        id: `${providerId}/${modelId}`,
        name: modelId,
        provider: providerId,
      });
    }

    return models;
  }

  // ========== Usage Command ==========

  private async showUsageStats(ctx: Context): Promise<void> {
    try {
      const chatId = String(ctx.chat?.id);
      const sessionKey = `telegram:${chatId}`;

      // Send system message to get usage stats
      await this.bus.publishInbound({
        channel: 'system',
        sender_id: 'telegram:usage',
        chat_id: chatId,
        content: '/usage',
        metadata: { sessionKey },
      });

      await ctx.reply(
        '📊 *Token Usage Stats*\n\n' +
        'Fetching usage statistics for this session...',
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      log.error({ err }, 'Failed to show usage stats');
      await ctx.reply('❌ Failed to fetch usage statistics.');
    }
  }

  // ========== Cleanup Command ==========

  private async handleCleanup(ctx: Context): Promise<void> {
    try {
      const keyboard = new InlineKeyboard()
        .text('🗑️ Archive sessions older than 30 days', 'cleanup:confirm').row()
        .text('❌ Cancel', 'cancel');

      await ctx.reply(
        '🧹 *Session Cleanup*\n\n' +
        'This will archive sessions that have been inactive for more than 30 days.\n\n' +
        'Archived sessions can be restored later.',
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );
    } catch (err) {
      log.error({ err }, 'Failed to show cleanup dialog');
      await ctx.reply('❌ Failed to initiate cleanup.');
    }
  }

  private async handleCleanupConfirm(ctx: Context): Promise<void> {
    try {
      await ctx.editMessageText('🧹 Cleaning up old sessions...');
      
      // Send system message to trigger cleanup
      const chatId = String(ctx.chat?.id);
      await this.bus.publishInbound({
        channel: 'system',
        sender_id: 'telegram:cleanup',
        chat_id: chatId,
        content: '/cleanup --days 30 --force',
      });

      await ctx.editMessageText('✅ Cleanup initiated. Old sessions will be archived.');
      await ctx.answerCallbackQuery('Cleanup started');
    } catch (err) {
      log.error({ err }, 'Failed to execute cleanup');
      await ctx.editMessageText('❌ Cleanup failed. Please try again later.');
      await ctx.answerCallbackQuery('Cleanup failed');
    }
  }

  // Get the model for a session (used by AgentService)
  getSessionModel(sessionKey: string): string | undefined {
    return this.sessionModels.get(sessionKey);
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
        apiRoot: (this.config as any).apiRoot || 'default'
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
      log.error({ err, apiRoot: (this.config as any).apiRoot }, 'getMe test failed');
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
