/**
 * Telegram Command Handler
 * 
 * 处理 /models, /usage, /cleanup 等命令
 */

import type { Context } from 'grammy';
import { createLogger } from '../../utils/logger.js';

import type { Config } from '../../config/index.js';
import { TelegramInlineKeyboards, type ModelInfo, type ProviderInfo } from './inline-keyboards.js';

const log = createLogger('TelegramCommandHandler');

export interface TelegramCommandHandlerDeps {
  bus: any;
  config: Config;
  getSessionModel: (sessionKey: string) => string | undefined;
  setSessionModel: (sessionKey: string, modelId: string) => void;
  showProviderModels?: (ctx: Context, providerId: string) => Promise<void>;
  showProvidersAgain?: (ctx: Context) => Promise<void>;
  handleCleanupConfirm?: (ctx: Context) => Promise<void>;
}

const DEFAULT_MODELS: Record<string, string[]> = {
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

const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  qwen: 'Qwen',
  kimi: 'Kimi',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax CN',
  zhipu: 'Zhipu',
  'zhipu-cn': 'Zhipu CN',
  deepseek: 'DeepSeek',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  xai: 'xAI',
  ollama: 'Ollama',
};

export function createTelegramCommandHandler(deps: TelegramCommandHandlerDeps) {
  const { config, getSessionModel, setSessionModel, bus } = deps;

  // ========== Helper Functions ==========

  const getAvailableProviders = (): ProviderInfo[] => {
    const modelProviders = config.models?.providers || {};
    const available: ProviderInfo[] = [];

    for (const [name, providerConfig] of Object.entries(modelProviders)) {
      if (providerConfig?.apiKey) {
        available.push({ id: name, name: PROVIDER_NAMES[name] || name });
      }
    }

    // Fallback defaults
    if (available.length === 0) {
      available.push({ id: 'minimax', name: 'MiniMax' }, { id: 'kimi', name: 'Kimi' });
    }

    return available;
  };

  const getModelsForProvider = (providerId: string): ModelInfo[] => {
    const providerConfig = config.models?.providers?.[providerId];
    const modelList = (providerConfig?.models || DEFAULT_MODELS[providerId] || ['default']) as string[];
    
    return modelList.map((modelId: string) => ({
      id: `${providerId}/${modelId}`,
      name: modelId,
      provider: providerId,
    }));
  };

  const getProviderDisplayName = (provider: string): string => {
    return PROVIDER_NAMES[provider] || provider;
  };

  // ========== Command Handlers ==========

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

  const handleProviderSelect = async (ctx: Context, providerId: string): Promise<void> => {
    try {
      const chatId = String(ctx.chat?.id);
      const sessionKey = `telegram:${chatId}`;
      const modelConfig = config.agents?.defaults?.model;
      // Handle both string and object model configs
      const defaultModel = typeof modelConfig === 'string' ? modelConfig : modelConfig?.primary || 'anthropic/claude-sonnet-4-5';
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
      const chatId = String(ctx.chat?.id);
      const sessionKey = `telegram:${chatId}`;

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

  const handleUsage = async (ctx: Context): Promise<void> => {
    try {
      const chatId = String(ctx.chat?.id);
      const sessionKey = `telegram:${chatId}`;

      await bus.publishInbound({
        channel: 'system',
        sender_id: 'telegram:usage',
        chat_id: chatId,
        content: '/usage',
        metadata: { sessionKey },
      });

      await ctx.reply(
        '📊 *Token Usage Stats*\n\nFetching usage statistics for this session...',
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      log.error({ err }, 'Failed to show usage stats');
      await ctx.reply('❌ Failed to fetch usage statistics.');
    }
  };

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

  const handleNew = async (ctx: Context): Promise<void> => {
    try {
      const chatId = String(ctx.chat?.id);
      const sessionKey = `telegram:${chatId}`;

      // Send command to agent service for processing
      await bus.publishInbound({
        channel: 'system',
        sender_id: 'telegram:new',
        chat_id: chatId,
        content: '/new',
        metadata: { sessionKey },
      });

      await ctx.reply('✅ Starting new session...');
    } catch (err) {
      log.error({ err }, 'Failed to start new session');
      await ctx.reply('❌ Failed to start new session. Please try again.');
    }
  };

  const handleSkills = async (ctx: Context, args?: string): Promise<void> => {
    try {
      const chatId = String(ctx.chat?.id);

      if (args === 'reload') {
        // Send reload command to agent service
        await bus.publishInbound({
          channel: 'system',
          sender_id: 'telegram:skills',
          chat_id: chatId,
          content: '/skills reload',
        });
        await ctx.reply('✅ Skills reloaded successfully');
      } else {
        // Show help
        await ctx.reply(
          '🛠️ *Skills Management*\n\n' +
          'Available commands:\n' +
          '/skills reload - Reload all skills from disk',
          { parse_mode: 'Markdown' }
        );
      }
    } catch (err) {
      log.error({ err }, 'Failed to handle skills command');
      await ctx.reply('❌ Failed to execute skills command.');
    }
  };

  const handleStart = async (ctx: Context): Promise<void> => {
    try {
      const providers = getAvailableProviders();
      const hasProviders = providers.length > 0;

      await ctx.reply(
        '👋 *Welcome to xopcbot!*\n\n' +
        'I am your AI assistant. Here are the available commands:\n\n' +
        '🤖 *Model Selection*\n' +
        '/models - Select a model to use\n\n' +
        '📊 *Session Management*\n' +
        '/usage - View token usage statistics\n' +
        '/new - Start a new session (archive current)\n' +
        '/cleanup - Clean up old sessions\n\n' +
        '🛠️ *Skills*\n' +
        '/skills - Manage skills (e.g., /skills reload)\n\n' +
        '💡 *Tip*: Just send a message to start chatting!' +
        (hasProviders ? '' : '\n\n⚠️ *Note*: No LLM providers configured. Please set up API keys in your config.'),
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      log.error({ err }, 'Failed to handle start command');
      await ctx.reply('❌ Failed to show welcome message.');
    }
  };

  return {
    handleModels,
    handleProviderSelect,
    handleModelSelect,
    handleShowProviders,
    handleUsage,
    handleCleanup,
    handleCleanupConfirm,
    handleCancel,
    handleNew,
    handleSkills,
    handleStart,
    getAvailableProviders,
  };
}
