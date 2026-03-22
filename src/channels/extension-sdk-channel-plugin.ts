/**
 * Bridges extension SDK ChannelExtension (connect/disconnect/sendMessage)
 * to the built-in ChannelPlugin surface used by ChannelManager.
 */

import type { Config } from '../config/index.js';
import type { ChannelExtension as SdkChannelExtension } from '../extensions/types/channels.js';
import type {
  ChannelPlugin,
  ChannelPluginInitOptions,
  ChannelPluginStartOptions,
  ChannelMetadata,
  ChannelOutboundContext,
  ChannelOutboundPayloadContext,
  OutboundDeliveryResult,
  ChannelCapabilities,
} from './plugin-types.js';
import type { OutboundMessage } from '../types/index.js';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ExtensionSdkChannel');

const DEFAULT_CAPABILITIES: ChannelCapabilities = {
  chatTypes: ['direct', 'group'],
  reactions: false,
  threads: false,
  media: true,
  polls: false,
  nativeCommands: false,
  blockStreaming: false,
};

export function isSdkChannelExtension(x: unknown): x is SdkChannelExtension {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.name === 'string' &&
    typeof o.connect === 'function' &&
    typeof o.disconnect === 'function' &&
    typeof o.sendMessage === 'function'
  );
}

export class ExtensionSdkChannelPlugin implements ChannelPlugin {
  readonly id: string;
  readonly meta: ChannelMetadata;
  readonly extensionManagedConfig = true;
  private connected = false;
  private readonly sdk: SdkChannelExtension;

  constructor(sdk: SdkChannelExtension) {
    this.sdk = sdk;
    this.id = sdk.name;
    this.meta = {
      id: sdk.name,
      name: sdk.name,
      description: `Extension channel (${sdk.name})`,
      capabilities: DEFAULT_CAPABILITIES,
    };
  }

  async init(_options: ChannelPluginInitOptions): Promise<void> {}

  async start(_options?: ChannelPluginStartOptions): Promise<void> {
    await this.sdk.connect();
    this.connected = true;
    log.info({ channel: this.id }, 'Extension SDK channel connected');
  }

  async stop(_accountId?: string): Promise<void> {
    await this.sdk.disconnect();
    this.connected = false;
    log.info({ channel: this.id }, 'Extension SDK channel disconnected');
  }

  channelIsRunning(_cfg: Config): boolean {
    return this.connected;
  }

  outbound = {
    deliveryMode: 'direct' as const,
    textChunkLimit: 4000,
    sendText: async (ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> => {
      try {
        await this.sdk.sendMessage(ctx.to, ctx.text, { parseMode: 'plain' });
        return { messageId: `ext-${randomUUID()}`, chatId: ctx.to, success: true };
      } catch (err) {
        return {
          messageId: '',
          chatId: ctx.to,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    sendPayload: async (
      ctx: ChannelOutboundPayloadContext,
    ): Promise<OutboundDeliveryResult> => {
      const payload = ctx.payload as OutboundMessage;
      if (payload.type === 'typing_on' || payload.type === 'typing_off') {
        if (payload.type === 'typing_on' && this.sdk.sendTyping) {
          try {
            await this.sdk.sendTyping(ctx.to);
          } catch {
            /* ignore */
          }
        }
        return { messageId: '', chatId: ctx.to, success: true };
      }
      try {
        await this.sdk.sendMessage(ctx.to, ctx.text ?? '', {
          parseMode: 'plain',
          replyTo: payload.replyToMessageId,
          threadId: payload.metadata?.threadId as string | undefined,
        });
        return { messageId: `ext-${randomUUID()}`, chatId: ctx.to, success: true };
      } catch (err) {
        return {
          messageId: '',
          chatId: ctx.to,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
