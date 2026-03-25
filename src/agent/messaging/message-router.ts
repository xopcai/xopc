/**
 * Message Router - Routes inbound messages to appropriate handlers
 *
 * Handles message classification, session key resolution, and routing logic.
 */

import type { InboundMessage } from '../../infra/bus/index.js';
import { parseSlashCommand } from '../../chat-commands/command-parse.js';
import type { AgentContext } from '../service.js';

export interface MessageRoutingResult {
  sessionKey: string;
  context: AgentContext;
  isSystemMessage: boolean;
  isCommand: boolean;
  command?: string;
  commandArgs?: string;
}

export interface MessageRouterConfig {
  workspace: string;
}

export class MessageRouter {
  private config: MessageRouterConfig;

  constructor(config: MessageRouterConfig) {
    this.config = config;
  }

  /**
   * Route an inbound message and determine handling strategy
   */
  async routeMessage(msg: InboundMessage): Promise<MessageRoutingResult> {
    // Resolve session key from metadata or derive from channel/chat_id
    const sessionKey = this.resolveSessionKey(msg);
    
    // Build context
    const context: AgentContext = {
      channel: msg.channel,
      chatId: msg.chat_id,
      sessionKey,
      senderId: (msg.metadata?.senderId as string) || msg.sender_id,
      isGroup: (msg.metadata?.isGroup as boolean) || false,
    };

    // Determine if this is a system message
    const isSystemMessage = msg.channel === 'system';

    // Check if message contains a command
    const commandInfo = parseSlashCommand(msg.content);

    return {
      sessionKey,
      context,
      isSystemMessage,
      isCommand: commandInfo !== null,
      command: commandInfo?.command,
      commandArgs: commandInfo?.args,
    };
  }

  /**
   * Resolve session key from message metadata or derive from channel/chat_id
   */
  private resolveSessionKey(msg: InboundMessage): string {
    // Use sessionKey from metadata if available (for channels with custom session key format like Telegram)
    if (msg.metadata?.sessionKey) {
      return msg.metadata.sessionKey as string;
    }

    // For system messages, parse origin channel from chat_id
    if (msg.channel === 'system') {
      if (msg.chat_id.includes(':')) {
        const [ch, ...rest] = msg.chat_id.split(':');
        return `${ch}:${rest.join(':')}`;
      }
    }

    // Default: combine channel and chat_id
    return `${msg.channel}:${msg.chat_id}`;
  }

  /**
   * Check if a message should be handled as a system command request
   * (e.g., from Telegram /new, /usage handlers sent via system channel)
   */
  isSystemCommandRequest(msg: InboundMessage): boolean {
    return msg.channel === 'system' && 
           msg.metadata?.sessionKey !== undefined && 
           msg.content.trim().startsWith('/');
  }
}
