/**
 * Command Handler - Parses and executes commands
 *
 * Handles command execution using the unified command system.
 */

import type { MessageBus } from '../../infra/bus/index.js';
import type { Config } from '../../config/schema.js';
import { isProviderConfiguredSync } from '../../providers/index.js';
import type { SessionConfigStore, SessionStore } from '../../session/index.js';
import type { ThinkLevel } from '../transcript/thinking-types.js';
import type { CompactionResult } from '../memory/compaction.js';
import { createLogger } from '../../utils/logger.js';
import { commandRegistry, createCommandContext } from '../../chat-commands/index.js';
import { getAllProviders, getModelsByProvider, getProviderDisplayName } from '../../providers/index.js';

const log = createLogger('CommandHandler');

export interface CommandContext {
  sessionKey: string;
  channel: string;
  chatId: string;
  senderId: string;
  isGroup: boolean;
}

export interface CommandHandlerConfig {
  config: Config;
  bus: MessageBus;
  sessionStore: SessionStore;
  sessionConfigStore?: SessionConfigStore;
  /** After /think persists, sync pi-agent */
  applySessionThinkingLevel?: (sessionKey: string, level: ThinkLevel) => void;
  getCurrentModel: () => string;
  switchModelForSession: (sessionKey: string, modelId: string) => Promise<boolean>;
  /** Drop in-memory agent after session file is cleared (e.g. /new) */
  invalidateAgentSession?: (sessionKey: string) => void;
  /** Cancel streaming preview + in-flight LLM work for this session (e.g. /abort) */
  abortSessionTurn?: (sessionKey: string) => Promise<void>;

  compactSession?: (
    sessionKey: string,
    options?: { instructions?: string; force?: boolean },
  ) => Promise<CompactionResult>;

  btwQuery?: (sessionKey: string, question: string) => Promise<{ text: string; error?: string }>;

  getSessionContextReport?: (
    sessionKey: string,
    mode: 'list' | 'detail' | 'json',
  ) => Promise<string>;
}

export class CommandHandler {
  private config: Config;
  private bus: MessageBus;
  private sessionStore: SessionStore;
  private sessionConfigStore?: SessionConfigStore;
  private applySessionThinkingLevel?: (sessionKey: string, level: ThinkLevel) => void;
  private getCurrentModel: () => string;
  private switchModelForSession: (sessionKey: string, modelId: string) => Promise<boolean>;
  private invalidateAgentSession?: (sessionKey: string) => void;
  private abortSessionTurn?: (sessionKey: string) => Promise<void>;
  private compactSession?: CommandHandlerConfig['compactSession'];
  private btwQuery?: CommandHandlerConfig['btwQuery'];
  private getSessionContextReport?: CommandHandlerConfig['getSessionContextReport'];

  constructor(handlerConfig: CommandHandlerConfig) {
    this.config = handlerConfig.config;
    this.bus = handlerConfig.bus;
    this.sessionStore = handlerConfig.sessionStore;
    this.sessionConfigStore = handlerConfig.sessionConfigStore;
    this.applySessionThinkingLevel = handlerConfig.applySessionThinkingLevel;
    this.getCurrentModel = handlerConfig.getCurrentModel;
    this.switchModelForSession = handlerConfig.switchModelForSession;
    this.invalidateAgentSession = handlerConfig.invalidateAgentSession;
    this.abortSessionTurn = handlerConfig.abortSessionTurn;
    this.compactSession = handlerConfig.compactSession;
    this.btwQuery = handlerConfig.btwQuery;
    this.getSessionContextReport = handlerConfig.getSessionContextReport;
  }

  /** Replace config reference after hot reload or gateway PATCH so commands see current defaults. */
  updateAgentConfig(config: Config): void {
    this.config = config;
  }

  /**
   * Execute a command using the unified command system
   */
  async executeCommand(
    commandName: string,
    args: string,
    context: CommandContext
  ): Promise<boolean> {
    // Check if command exists
    if (!commandRegistry.has(commandName)) {
      return false;
    }

    log.info({ command: commandName, sessionKey: context.sessionKey }, 'Executing command via new system');

    // Create command context
    const cmdCtx = createCommandContext({
      sessionKey: context.sessionKey,
      source: context.channel as 'telegram' | 'webui' | 'cli' | 'api' | 'system' | 'gateway',
      channelId: context.channel,
      chatId: context.chatId,
      senderId: context.senderId,
      isGroup: context.isGroup,
      config: this.config,
      bus: this.bus,
      sessionStore: this.sessionStore,
      sessionConfigStore: this.sessionConfigStore,
      applySessionThinkingLevel: this.applySessionThinkingLevel,

      replyHandler: async (text: string, _options?) => {
        await this.bus.publishOutbound({
          channel: context.channel,
          chat_id: context.chatId,
          content: text,
          type: 'message',
        });
      },

      typingHandler: async (typing: boolean) => {
        await this.bus.publishOutbound({
          channel: context.channel,
          chat_id: context.chatId,
          type: typing ? 'typing_on' : 'typing_off',
        });
      },

      supportedFeatures: ['markdown', 'typing'],

      getCurrentModel: this.getCurrentModel,

      switchModel: async (modelId: string) => {
        return this.switchModelForSession(context.sessionKey, modelId);
      },

      listModels: async () => {
        const providers = getAllProviders();
        const models: Array<{ id: string; name: string; provider: string }> = [];

        for (const providerId of providers) {
          if (isProviderConfiguredSync(providerId)) {
            const providerModels = getModelsByProvider(providerId);
            for (const m of providerModels) {
              models.push({
                id: `${m.provider}/${m.id}`,
                name: m.name || m.id,
                provider: getProviderDisplayName(providerId),
              });
            }
          }
        }

        return models;
      },

      getUsage: async () => {
        const messages = await this.sessionStore.load(context.sessionKey);
        let promptTokens = 0;
        let completionTokens = 0;

        for (const msg of messages) {
          if ('usage' in msg && msg.usage) {
            const usage = msg.usage as any;
            promptTokens += usage.input || 0;
            completionTokens += usage.output || 0;
          }
        }

        return {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          messageCount: messages.length,
        };
      },

      invalidateAgentSession: this.invalidateAgentSession,

      abortCurrentTurn: this.abortSessionTurn
        ? async () => {
            await this.abortSessionTurn!(context.sessionKey);
          }
        : undefined,

      compactSession: this.compactSession,
      btwQuery: this.btwQuery,
      getSessionContextReport: this.getSessionContextReport,
    });

    const result = await commandRegistry.execute(commandName, cmdCtx, args);

    if (result.content) {
      await this.bus.publishOutbound({
        channel: context.channel,
        chat_id: context.chatId,
        content: result.content,
        type: 'message',
      });
    }

    return true;
  }

  /**
   * Run command and return all user-visible text (ctx.reply + result.content) for SSE/CLI.
   * Same bus side effects as {@link executeCommand}.
   */
  async executeCommandAndAggregateReply(
    commandName: string,
    args: string,
    context: CommandContext,
  ): Promise<{ handled: boolean; aggregatedText: string }> {
    if (!commandRegistry.has(commandName)) {
      return { handled: false, aggregatedText: '' };
    }

    log.info({ command: commandName, sessionKey: context.sessionKey }, 'Executing command (aggregate reply)');

    const { aggregatedText } = await this.runRegistryExecuteWithCapture(args, commandName, context);

    return { handled: true, aggregatedText };
  }

  private async runRegistryExecuteWithCapture(
    args: string,
    commandName: string,
    context: CommandContext,
  ): Promise<{ aggregatedText: string }> {
    const segments: string[] = [];

    const wrapped = createCommandContext({
      sessionKey: context.sessionKey,
      source: context.channel as 'telegram' | 'webui' | 'cli' | 'api' | 'system' | 'gateway',
      channelId: context.channel,
      chatId: context.chatId,
      senderId: context.senderId,
      isGroup: context.isGroup,
      config: this.config,
      bus: this.bus,
      sessionStore: this.sessionStore,
      sessionConfigStore: this.sessionConfigStore,
      applySessionThinkingLevel: this.applySessionThinkingLevel,

      replyHandler: async (text: string, _options?) => {
        segments.push(text);
        await this.bus.publishOutbound({
          channel: context.channel,
          chat_id: context.chatId,
          content: text,
          type: 'message',
        });
      },

      typingHandler: async (typing: boolean) => {
        await this.bus.publishOutbound({
          channel: context.channel,
          chat_id: context.chatId,
          type: typing ? 'typing_on' : 'typing_off',
        });
      },

      supportedFeatures: ['markdown', 'typing'],

      getCurrentModel: this.getCurrentModel,

      switchModel: async (modelId: string) => {
        return this.switchModelForSession(context.sessionKey, modelId);
      },

      listModels: async () => {
        const providers = getAllProviders();
        const models: Array<{ id: string; name: string; provider: string }> = [];

        for (const providerId of providers) {
          if (isProviderConfiguredSync(providerId)) {
            const providerModels = getModelsByProvider(providerId);
            for (const m of providerModels) {
              models.push({
                id: `${m.provider}/${m.id}`,
                name: m.name || m.id,
                provider: getProviderDisplayName(providerId),
              });
            }
          }
        }

        return models;
      },

      getUsage: async () => {
        const messages = await this.sessionStore.load(context.sessionKey);
        let promptTokens = 0;
        let completionTokens = 0;

        for (const msg of messages) {
          if ('usage' in msg && msg.usage) {
            const usage = msg.usage as { input?: number; output?: number };
            promptTokens += usage.input || 0;
            completionTokens += usage.output || 0;
          }
        }

        return {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          messageCount: messages.length,
        };
      },

      invalidateAgentSession: this.invalidateAgentSession,

      abortCurrentTurn: this.abortSessionTurn
        ? async () => {
            await this.abortSessionTurn!(context.sessionKey);
          }
        : undefined,

      compactSession: this.compactSession,
      btwQuery: this.btwQuery,
      getSessionContextReport: this.getSessionContextReport,
    });

    const result = await commandRegistry.execute(commandName, wrapped, args);

    if (result.content) {
      segments.push(result.content);
      await this.bus.publishOutbound({
        channel: context.channel,
        chat_id: context.chatId,
        content: result.content,
        type: 'message',
      });
    }

    const aggregatedText = segments.filter((s) => s && s.trim()).join('\n\n');
    return { aggregatedText };
  }
}
