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
import {
  commandRegistry,
  createCommandContext,
  type BtwQueryOptions,
  type CommandContext as UnifiedCommandContext,
  type CommandStreamEvent,
} from '../../chat-commands/index.js';
import { getAllProviders, getModelsByProvider, getProviderDisplayName } from '../../providers/index.js';
import type { PersistentGoalApis } from '../goals/persistent-goal-apis.js';
import type { WorkflowRunServiceLike } from '../../workflows/service/workflow-run-service.types.js';
import type {
  SkillInstallToolOptions,
  SkillInstallToolResult,
} from '../tools/skill-install-tool.js';

const log = createLogger('CommandHandler');

/** Gateway console direct stream uses SSE tokens; there is no ChannelPlugin outbound for `webchat`. */
function shouldSkipBusOutboundForChannel(channel: string): boolean {
  return channel === 'webchat';
}

export interface CommandContext {
  sessionKey: string;
  channel: string;
  chatId: string;
  senderId: string;
  isGroup: boolean;
  /** From inbound message metadata (thread/account, etc.) for `/goal` continuation routing. */
  inboundMetadata?: Record<string, unknown>;
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
  /** Reset session in place (archive transcript, new session id; preserve overrides) */
  resetSession?: (sessionKey: string) => Promise<{ sessionId: string; previousSessionId: string } | null>;
  /** Cancel streaming preview + in-flight LLM work for this session (e.g. /abort) */
  abortSessionTurn?: (sessionKey: string) => Promise<void>;
  /** Reload skills from disk and refresh active agent prompts. */
  reloadSkills?: () => void | Promise<void>;
  /** Install a managed skill from an explicit source and refresh active agent prompts. */
  installSkillFromSource?: (opts: SkillInstallToolOptions) => Promise<SkillInstallToolResult>;

  compactSession?: (
    sessionKey: string,
    options?: { instructions?: string; force?: boolean },
  ) => Promise<CompactionResult>;

  btwQuery?: (
    sessionKey: string,
    question: string,
    options?: BtwQueryOptions,
  ) => Promise<{ text: string; error?: string }>;

  getSessionContextReport?: (
    sessionKey: string,
    mode: 'list' | 'detail' | 'json',
  ) => Promise<string>;

  getPersistentGoalApisForCommand: (routing: {
    sessionKey: string;
    channel: string;
    chatId: string;
    inboundMetadata?: Record<string, unknown>;
  }) => PersistentGoalApis;
  getWorkflowRunService?: () => WorkflowRunServiceLike | undefined;
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
  private reloadSkills?: CommandHandlerConfig['reloadSkills'];
  private installSkillFromSource?: CommandHandlerConfig['installSkillFromSource'];
  private compactSession?: CommandHandlerConfig['compactSession'];
  private btwQuery?: CommandHandlerConfig['btwQuery'];
  private getSessionContextReport?: CommandHandlerConfig['getSessionContextReport'];
  private getPersistentGoalApisForCommand: CommandHandlerConfig['getPersistentGoalApisForCommand'];
  private resetSession?: CommandHandlerConfig['resetSession'];
  private getWorkflowRunService?: CommandHandlerConfig['getWorkflowRunService'];

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
    this.reloadSkills = handlerConfig.reloadSkills;
    this.installSkillFromSource = handlerConfig.installSkillFromSource;
    this.compactSession = handlerConfig.compactSession;
    this.btwQuery = handlerConfig.btwQuery;
    this.getSessionContextReport = handlerConfig.getSessionContextReport;
    this.getPersistentGoalApisForCommand = handlerConfig.getPersistentGoalApisForCommand;
    this.resetSession = handlerConfig.resetSession;
    this.getWorkflowRunService = handlerConfig.getWorkflowRunService;
  }

  /** Replace config reference after hot reload or gateway PATCH so commands see current defaults. */
  updateAgentConfig(config: Config): void {
    this.config = config;
  }

  /**
   * Build the unified command context shared by all execute paths.
   * When `recorder` is set, every reply text is also captured (for SSE / CLI aggregation).
   */
  private buildCommandContext(
    context: CommandContext,
    recorder?: (text: string) => void,
    emitEvent?: (event: CommandStreamEvent) => void | Promise<void>,
  ): UnifiedCommandContext {
    const skipBusOutbound = shouldSkipBusOutboundForChannel(context.channel);

    return createCommandContext({
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
        recorder?.(text);
        if (skipBusOutbound) return;
        await this.bus.publishOutbound({
          channel: context.channel,
          chat_id: context.chatId,
          content: text,
          type: 'message',
        });
      },

      typingHandler: async (typing: boolean) => {
        if (skipBusOutbound) return;
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

      resetSession: this.resetSession
        ? async (sk) => {
            await this.resetSession!(sk);
          }
        : undefined,

      abortCurrentTurn: this.abortSessionTurn
        ? async () => {
            await this.abortSessionTurn!(context.sessionKey);
          }
        : undefined,
      reloadSkills: this.reloadSkills
        ? async () => {
            await this.reloadSkills!();
          }
        : undefined,
      installSkillFromSource: this.installSkillFromSource
        ? (opts) => this.installSkillFromSource!({ ...opts, sessionKey: context.sessionKey })
        : undefined,

      compactSession: this.compactSession,
      btwQuery: this.btwQuery,
      emitEvent,
      getSessionContextReport: this.getSessionContextReport,
      persistentGoalApis: this.getPersistentGoalApisForCommand({
        sessionKey: context.sessionKey,
        channel: context.channel,
        chatId: context.chatId,
        inboundMetadata: context.inboundMetadata,
      }),
      workflowRunService: this.getWorkflowRunService?.(),
    });
  }

  /**
   * Execute a command using the unified command system
   */
  async executeCommand(
    commandName: string,
    args: string,
    context: CommandContext,
  ): Promise<boolean> {
    if (!commandRegistry.has(commandName)) {
      return false;
    }

    log.info({ command: commandName, sessionKey: context.sessionKey }, 'Executing command via new system');

    const cmdCtx = this.buildCommandContext(context);
    const result = await commandRegistry.execute(commandName, cmdCtx, args);

    if (result.content && !shouldSkipBusOutboundForChannel(context.channel)) {
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
    options?: { emitEvent?: (event: CommandStreamEvent) => void | Promise<void> },
  ): Promise<{ handled: boolean; aggregatedText: string; metadata?: Record<string, unknown> }> {
    if (!commandRegistry.has(commandName)) {
      return { handled: false, aggregatedText: '' };
    }

    log.info({ command: commandName, sessionKey: context.sessionKey }, 'Executing command (aggregate reply)');

    const segments: string[] = [];
    const wrapped = this.buildCommandContext(context, (text) => segments.push(text), options?.emitEvent);
    const result = await commandRegistry.execute(commandName, wrapped, args);

    if (result.content) {
      segments.push(result.content);
      if (!shouldSkipBusOutboundForChannel(context.channel)) {
        await this.bus.publishOutbound({
          channel: context.channel,
          chat_id: context.chatId,
          content: result.content,
          type: 'message',
        });
      }
    }

    const aggregatedText = segments.filter((s) => s && s.trim()).join('\n\n');
    return { handled: true, aggregatedText, metadata: result.metadata };
  }
}
