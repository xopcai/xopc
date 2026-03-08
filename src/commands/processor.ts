/**
 * Command Processor
 *
 * Integrates the command system with AgentService.
 * Processes incoming messages and routes commands appropriately.
 */

import type { UnifiedMessage, CommandContext } from './types.js';
import { commandRegistry } from './registry.js';
import { createCommandContext } from './context.js';
import type { MessageBus } from '../bus/index.js';
import type { SessionStore } from '../session/index.js';
import type { Config } from '../config/schema.js';
import { createLogger } from '../utils/logger.js';
import { getRoutingInfo } from './session-key.js';

const log = createLogger('CommandProcessor');

export interface CommandProcessorDeps {
  bus: MessageBus;
  sessionStore: SessionStore;
  config: Config;
  // Model management callbacks
  getCurrentModel: () => string;
  switchModel: (modelId: string) => Promise<boolean>;
  listModels: () => Promise<Array<{ id: string; name: string; provider: string }>>;
  getUsage: () => Promise<{ promptTokens: number; completionTokens: number; totalTokens: number; messageCount: number }>;
}

/**
 * Process a unified message
 * Returns true if the message was handled (command or otherwise), false if should continue to AI
 */
export async function processMessage(
  message: UnifiedMessage,
  deps: CommandProcessorDeps
): Promise<boolean> {
  // If it's a command, execute it
  if (message.isCommand && message.commandName) {
    return executeCommand(message, deps);
  }

  // Not a command, let AI handle it
  return false;
}

/**
 * Execute a command from a unified message
 */
async function executeCommand(
  message: UnifiedMessage,
  deps: CommandProcessorDeps
): Promise<boolean> {
  const { commandName, commandArgs } = message;
  
  if (!commandName) return false;

  log.info({ command: commandName, sessionKey: message.sessionKey }, 'Executing command');

  // Create command context
  const ctx = await createCommandContextFromMessage(message, deps);

  // Execute command
  const result = await commandRegistry.execute(commandName, ctx, commandArgs || '');

  // Send response if there's content
  if (result.content) {
    const routing = getRoutingInfo(message.sessionKey);
    await deps.bus.publishOutbound({
      channel: routing.channel,
      chat_id: routing.chatId,
      content: result.content,
      type: 'message',
      metadata: {
        threadId: routing.threadId,
      },
    });
  }

  return true;
}

/**
 * Create a command context from a unified message
 */
async function createCommandContextFromMessage(
  message: UnifiedMessage,
  deps: CommandProcessorDeps
): Promise<CommandContext> {
  const routing = getRoutingInfo(message.sessionKey);

  return createCommandContext({
    sessionKey: message.sessionKey,
    source: message.source,
    channelId: message.channelId,
    chatId: message.chatId,
    senderId: message.senderId,
    isGroup: message.platformData.isGroup,
    config: deps.config,
    bus: deps.bus,
    sessionStore: deps.sessionStore,
    
    // Reply handler
    replyHandler: async (text: string, options?) => {
      await deps.bus.publishOutbound({
        channel: routing.channel,
        chat_id: routing.chatId,
        content: text,
        type: 'message',
        metadata: {
          threadId: routing.threadId,
          parseMode: options?.parseMode,
        },
      });
    },

    // Typing handler
    typingHandler: async (typing: boolean) => {
      await deps.bus.publishOutbound({
        channel: routing.channel,
        chat_id: routing.chatId,
        type: typing ? 'typing_on' : 'typing_off',
        metadata: {
          threadId: routing.threadId,
        },
      });
    },

    // Supported features (would be determined by channel)
    supportedFeatures: ['markdown', 'typing'],

    // Model management
    getCurrentModel: deps.getCurrentModel,
    switchModel: deps.switchModel,
    listModels: deps.listModels,
    getUsage: deps.getUsage,
  });
}
