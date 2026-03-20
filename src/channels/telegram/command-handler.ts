/**
 * Telegram Command Handler
 * 
 * Handles Telegram-specific UI interactions (inline keyboards, callbacks).
 * Core commands (/new, /usage, /models, etc.) are handled by the unified command system.
 */

import type { Context } from 'grammy';
import { createLogger } from '../../utils/logger.js';
import type { Config } from '../../config/index.js';
import { isProviderConfiguredSync } from '../../providers/index.js';
import { TelegramInlineKeyboards, type ProviderInfo } from './inline-keyboards.js';
import { getProviderDisplayName, getModelsByProvider, getDefaultModelSync, getAllProviders } from '../../providers/index.js';
import { generateSessionKey } from '../../commands/session-key.js';

const log = createLogger('TelegramCommandHandler');

export interface TelegramCommandHandlerDeps {
  bus: any;
  config: Config;
  getSessionModel: (sessionKey: string) => string | undefined;
  setSessionModel: (sessionKey: string, modelId: string) => void;
  // Optional callbacks for inline keyboard handling
  showProviderModels?: (ctx: Context, providerId: string) => Promise<void>;
  showProvidersAgain?: (ctx: Context) => Promise<void>;
  handleCleanupConfirm?: (ctx: Context) => Promise<void>;
}

export function createTelegramCommandHandler(deps: TelegramCommandHandlerDeps) {
  const { config, getSessionModel, setSessionModel, bus } = deps;

  // ========== Helper Functions ==========

  const getAvailableProviders = (): ProviderInfo[] => {
    const allProviders = getAllProviders();
    const available: ProviderInfo[] = [];

    for (const providerId of allProviders) {
      if (isProviderConfiguredSync(providerId)) {
        available.push({ id: providerId, name: getProviderDisplayName(providerId) });
      }
    }

    if (available.length === 0) {
      available.push({ id: 'minimax', name: 'MiniMax' }, { id: 'kimi', name: 'Kimi' });
    }

    return available;
  };

  const getModelsForProvider = (providerId: string) => {
    const models = getModelsByProvider(providerId);
    
    if (models.length === 0) {
      return [{ id: `${providerId}/default`, name: 'default', provider: providerId }];
    }
    
    return models.map(m => ({
      id: `${m.provider}/${m.id}`,
      name: m.name || m.id,
      provider: m.provider,
    }));
  };

  // ========== Helper Functions ==========

  // Helper to get sessionKey from Telegram context
  const getSessionKeyFromCtx = (ctx: Context): string => {
    const chatId = String(ctx.chat?.id);
    const senderId = String(ctx.from?.id);
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    const threadId = (ctx.message as { message_thread_id?: number })?.message_thread_id;

    return generateSessionKey({
      source: 'telegram',
      chatId,
      senderId,
      isGroup,
      threadId: threadId ? String(threadId) : undefined,
    });
  };

  // ========== Command Handlers ==========

  /**
   * /start - Show welcome message
   * Note: Other commands (/new, /usage, /models, etc.) are handled by the unified command system
   */
  const handleStart = async (ctx: Context): Promise<void> => {
    try {
      const providers = getAvailableProviders();
      const hasProviders = providers.length > 0;

      await ctx.reply(
        '👋 *Welcome to xopcbot!*\n\n' +
        'I am your AI assistant. Here are the available commands:\n\n' +
        '🤖 *Model Selection*\n' +
        '/models - Select a model to use\n' +
        '/switch \u003cmodel-id\u003e - Switch to a specific model\n\n' +
        '📊 *Session Management*\n' +
        '/new - Start a new session (archive current)\n' +
        '/list - List all your sessions\n' +
        '/usage - View token usage statistics\n' +
        '/cleanup - Clean up old sessions\n\n' +
        '🔊 *Voice (TTS)*\n' +
        '/tts - Show TTS settings\n' +
        '/tts on|off - Enable/disable TTS\n' +
        '/tts always|inbound|tagged|never - Set trigger mode\n\n' +
        '🛠️ *Skills*\n' +
        '/skills reload - Reload all skills from disk\n\n' +
        '💡 *Tip*: Just send a message to start chatting!' +
        (hasProviders ? '' : '\n\n⚠️ *Note*: No LLM providers configured. Please set up API keys in your config.'),
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      log.error({ err }, 'Failed to handle start command');
      await ctx.reply('❌ Failed to show welcome message.');
    }
  };

  /**
   * /models - Show model selector with inline keyboard
   * Note: This provides a UI enhancement over the basic /models command
   */
  const handleModels = async (ctx: Context): Promise<void> => {
    try {
      const providers = getAvailableProviders();

      if (providers.length === 0) {
        await ctx.reply('❌ No providers available. Please check your configuration.');
        return;
      }

      await ctx.reply('🤖 Select a provider:', {
        reply_markup: TelegramInlineKeyboards.providerSelector(providers),
      });
    } catch (err) {
      log.error({ err }, 'Failed to show provider selector');
      await ctx.reply('❌ Failed to load providers. Please try again.');
    }
  };

  /**
   * /cleanup - Show cleanup confirmation dialog
   */
  const handleCleanup = async (ctx: Context): Promise<void> => {
    try {
      await ctx.reply(
        '🧹 *Session Cleanup*\n\n' +
        'This will archive sessions that have been inactive for more than 30 days.\n\n' +
        'Archived sessions can be restored later.',
        { parse_mode: 'Markdown', reply_markup: TelegramInlineKeyboards.cleanupConfirm() }
      );
    } catch (err) {
      log.error({ err }, 'Failed to show cleanup dialog');
      await ctx.reply('❌ Failed to initiate cleanup.');
    }
  };

  // ========== Callback Handlers (Inline Keyboard) ==========

  const handleProviderSelect = async (ctx: Context, providerId: string): Promise<void> => {
    try {
      const sessionKey = getSessionKeyFromCtx(ctx);
      const modelConfig = config.agents?.defaults?.model;
      const defaultModel = typeof modelConfig === 'string' ? modelConfig : modelConfig?.primary || getDefaultModelSync(config);
      const currentModel = getSessionModel(sessionKey) || defaultModel;

      const models = getModelsForProvider(providerId);
      
      if (models.length === 0) {
        await ctx.editMessageText('❌ No models available for this provider.');
        await ctx.answerCallbackQuery();
        return;
      }

      const keyboard = TelegramInlineKeyboards.modelSelector(models, currentModel);
      const providerName = getProviderDisplayName(providerId);
      
      await ctx.editMessageText(`🤖 Select a model from *${providerName}*:`, { 
        reply_markup: keyboard,
        parse_mode: 'Markdown',
      });
      await ctx.answerCallbackQuery();
    } catch (err) {
      log.error({ err, providerId }, 'Failed to show provider models');
      await ctx.answerCallbackQuery('Failed to load models');
    }
  };

  const handleModelSelect = async (ctx: Context, modelId: string): Promise<void> => {
    try {
      const sessionKey = getSessionKeyFromCtx(ctx);
      setSessionModel(sessionKey, modelId);

      const modelName = modelId.split('/').pop() || modelId;
      await ctx.editMessageText(
        `✅ Model switched to *${modelName}*\n\nThis model will be used for your next message.`,
        { parse_mode: 'Markdown' }
      );
      await ctx.answerCallbackQuery(`Switched to ${modelName}`);

      log.info({ sessionKey, modelId }, 'Model switched via Telegram');
    } catch (err) {
      log.error({ err }, 'Failed to handle model selection');
      await ctx.answerCallbackQuery('Failed to switch model');
    }
  };

  const handleShowProviders = async (ctx: Context): Promise<void> => {
    try {
      const providers = getAvailableProviders();

      await ctx.editMessageText('🤖 Select a provider:', {
        reply_markup: TelegramInlineKeyboards.providerSelector(providers),
      });
      await ctx.answerCallbackQuery();
    } catch (err) {
      log.error({ err }, 'Failed to show providers again');
      await ctx.answerCallbackQuery('Failed to go back');
    }
  };

  const handleCleanupConfirm = async (ctx: Context): Promise<void> => {
    try {
      await ctx.editMessageText('🧹 Cleaning up old sessions...');
      
      const chatId = String(ctx.chat?.id);

      await bus.publishInbound({
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
  };

  const handleCancel = async (ctx: Context): Promise<void> => {
    await ctx.editMessageText('Cancelled.');
    await ctx.answerCallbackQuery();
  };

  return {
    // Command handlers
    handleStart,
    handleModels,
    handleCleanup,
    // Callback handlers
    handleProviderSelect,
    handleModelSelect,
    handleShowProviders,
    handleCleanupConfirm,
    handleCancel,
    // Helpers
    getAvailableProviders,
  };
}
