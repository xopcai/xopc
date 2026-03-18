/**
 * Channel Extension Adapter
 * 
 *  Bridges extension-defined channels to the built-in ChannelExtension interface
 * so they can be registered with ChannelManager.
 */

import type { ChannelExtension as ExtensionChannelDef, SendMessageOptions } from './types/channels.js';
import type {
  ChannelExtension as BuiltinChannelExtension,
  ChannelType,
  ChannelMetadata,
  ChannelCapabilities,
  ChannelInitOptions,
  ChannelStartOptions,
  ChannelSendOptions,
  ChannelSendResult,
  ChannelSendStreamOptions,
  ChannelStreamHandle,
  ChannelStatus,
} from '../channels/types.js';

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_CHANNEL_CAPABILITIES: ChannelCapabilities = {
  chatTypes: ['direct'],
  reactions: false,
  threads: false,
  media: false,
  polls: false,
  nativeCommands: false,
  blockStreaming: false,
};

// ============================================================================
// Channel Adapter
// ============================================================================

/**
 * Adapt an extension-defined channel to the built-in ChannelExtension interface.
 * This allows extension authors to implement the simpler ExtensionChannelDef interface
 * and have it work with ChannelManager.
 * 
 * Limitations of adapted channels compared to native channels:
 * - startStream() returns a no-op handle (extension channels do not support streaming)
 * - getStatus() returns a static status (extension channels do not report live status)
 * - testConnection() performs a connect/disconnect cycle as a basic health check
 */
export function adaptExtensionChannel(
  extensionChannel: ExtensionChannelDef,
): BuiltinChannelExtension {
  const channelId = extensionChannel.name as ChannelType;
  const meta: ChannelMetadata = {
    id: channelId,
    name: extensionChannel.name,
    description: `Extension channel: ${extensionChannel.name}`,
    capabilities: DEFAULT_CHANNEL_CAPABILITIES,
  };

  return {
    id: channelId,
    meta,
    async init(_options: ChannelInitOptions): Promise<void> {
      // Extension channels handle initialization in connect()
    },
    async start(_options?: ChannelStartOptions): Promise<void> {
      await extensionChannel.connect();
    },
    async stop(_accountId?: string): Promise<void> {
      await extensionChannel.disconnect();
    },
    async send(options: ChannelSendOptions): Promise<ChannelSendResult> {
      const sendOptions: SendMessageOptions = {
        parseMode: 'plain',
        replyTo: options.replyToMessageId,
        threadId: options.threadId,
      };
      try {
        await extensionChannel.sendMessage(options.chatId, options.content, sendOptions);
        return { messageId: `ext-${Date.now()}`, chatId: options.chatId, success: true };
      } catch (error) {
        return {
          messageId: '',
          chatId: options.chatId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    startStream(_options: ChannelSendStreamOptions): ChannelStreamHandle {
      // Extension channels do not support streaming; return a no-op handle.
      return {
        update: (_text: string) => {},
        end: async () => {},
        abort: async () => {},
        messageId: () => undefined,
      };
    },
    getStatus(_accountId?: string): ChannelStatus {
      return {
        accountId: 'default',
        running: true,
        mode: 'polling',
      };
    },
    async testConnection(): Promise<{ success: boolean; error?: string }> {
      try {
        await extensionChannel.connect();
        await extensionChannel.disconnect();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * Check if an extension channel has the minimum required methods to be adapted.
 */
export function isAdaptableChannel(channel: ExtensionChannelDef): boolean {
  return !!(
    channel.name &&
    typeof channel.connect === 'function' &&
    typeof channel.disconnect === 'function' &&
    typeof channel.sendMessage === 'function'
  );
}

/**
 * Get the list of required method names for an extension channel.
 */
export function getRequiredChannelMethods(): string[] {
  return ['name', 'connect', 'disconnect', 'sendMessage'];
}
