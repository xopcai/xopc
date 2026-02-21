/**
 * WhatsApp Channel Plugin
 * 
 * 插件模式实现（未来）
 * 
 * TODO: 实现完整的 WhatsApp 插件支持
 * - 多账户支持
 * - 群组管理
 * - 媒体处理
 * - 消息加密
 */

import type {
  ChannelPlugin,
  ChannelInitOptions,
  ChannelStartOptions,
  ChannelSendOptions,
  ChannelSendStreamOptions,
  ChannelSendResult,
  ChannelStatus,
  ChannelMetadata,
} from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('WhatsAppPlugin');

export class WhatsAppChannelPlugin implements ChannelPlugin {
  id = 'whatsapp' as const;
  
  meta: ChannelMetadata = {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'WhatsApp messaging channel',
    capabilities: {
      chatTypes: ['direct', 'group'],
      reactions: true,
      threads: false,
      media: true,
      polls: false,
      nativeCommands: false,
      blockStreaming: false,
    },
  };

  async init(options: ChannelInitOptions): Promise<void> {
    const whatsappConfig = options.config.channels?.whatsapp;
    if (!whatsappConfig?.enabled) {
      log.info('WhatsApp channel disabled in config');
      return;
    }

    log.warn('WhatsApp plugin not yet implemented');
    log.info('Install @whiskeysockets/baileys to enable WhatsApp support');
  }

  async start(_options?: ChannelStartOptions): Promise<void> {
    log.warn('WhatsApp plugin start not implemented');
  }

  async stop(_accountId?: string): Promise<void> {
    log.warn('WhatsApp plugin stop not implemented');
  }

  async send(_options: ChannelSendOptions): Promise<ChannelSendResult> {
    log.warn('WhatsApp send not implemented');
    return { messageId: '', chatId: '', success: false, error: 'WhatsApp not implemented' };
  }

  startStream(_options: ChannelSendStreamOptions): ReturnType<ChannelPlugin['startStream']> {
    log.warn('WhatsApp streaming not implemented');
    return {
      update: () => {},
      end: async () => {},
      abort: async () => {},
      messageId: () => undefined,
    };
  }

  getStatus(_accountId?: string): ChannelStatus {
    return { accountId: 'default', running: false, mode: 'stopped' };
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'WhatsApp not implemented' };
  }
}

export const whatsappPlugin = new WhatsAppChannelPlugin();
