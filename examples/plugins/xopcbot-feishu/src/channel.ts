/**
 * Feishu Channel - Main channel implementation
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import type { PluginApi, ChannelPlugin, OutboundMessage } from 'xopcbot/plugin-sdk';
import { createFeishuWSClient, createEventDispatcher } from './client.js';
import { sendMessage } from './send.js';
import { resolveFeishuMediaList } from './media.js';
import { checkDMPolicy, checkGroupPolicy } from './policy.js';
import { parseMessageEvent, buildSessionKey } from './parser.js';
import { tryRecordMessage, type FeishuConfig, type FeishuMessageEvent } from './types.js';

export interface FeishuChannelOptions {
  config: FeishuConfig;
  api: PluginApi;
  defaultAgentId: string;
}

export class FeishuChannel implements ChannelPlugin {
  name = 'feishu';
  private wsClient?: Lark.WSClient;
  private config: FeishuConfig;
  private api: PluginApi;
  private defaultAgentId: string;
  private running = false;
  private botOpenId?: string;

  constructor(options: FeishuChannelOptions) {
    this.config = options.config;
    this.api = options.api;
    this.defaultAgentId = options.defaultAgentId;
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) {
      this.api.logger.warn('Feishu channel already running');
      return;
    }

    if (!this.config.enabled) {
      this.api.logger.info('Feishu channel is disabled');
      return;
    }

    if (!this.config.appId || !this.config.appSecret) {
      throw new Error('Feishu appId and appSecret are required');
    }

    this.api.logger.info(`Starting Feishu channel (appId: ${this.config.appId})`);

    try {
      // Resolve bot OpenID
      await this.resolveBotInfo();

      // Create event dispatcher
      const eventDispatcher = createEventDispatcher(this.config);
      this.registerEventHandlers(eventDispatcher);

      // Create and start WebSocket client
      this.wsClient = createFeishuWSClient(this.config);
      this.wsClient.start({ eventDispatcher });

      this.running = true;
      this.api.logger.info('Feishu channel started successfully');
    } catch (error) {
      this.api.logger.error(`Failed to start Feishu channel: ${error}`);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.api.logger.info('Stopping Feishu channel');

    // WSClient doesn't have a direct stop method, but we can clean up
    this.wsClient = undefined;
    this.running = false;

    this.api.logger.info('Feishu channel stopped');
  }

  async send(message: OutboundMessage): Promise<void> {
    const { channel, chat_id, content } = message;

    if (channel !== 'feishu') {
      throw new Error(`Unsupported channel: ${channel}`);
    }

    try {
      await sendMessage({
        config: this.config,
        to: chat_id,
        text: content,
      });
    } catch (error) {
      this.api.logger.error(`Failed to send message: ${error}`);
      throw error;
    }
  }

  /**
   * Resolve bot info (name, open_id)
   */
  private async resolveBotInfo(): Promise<void> {
    try {
      const client = createFeishuWSClient(this.config);
      // We'll get bot info from incoming messages
      this.api.logger.info('Bot info will be resolved from incoming events');
    } catch (error) {
      this.api.logger.warn(`Could not resolve bot info: ${error}`);
    }
  }

  /**
   * Register event handlers
   */
  private registerEventHandlers(dispatcher: Lark.EventDispatcher): void {
    // Handle incoming messages
    dispatcher.register({
      'im.message.receive_v1': async (data) => {
        await this.handleIncomingMessage(data as unknown as FeishuMessageEvent);
      },
      'im.message.message_read_v1': async () => {
        // Ignore read receipts
      },
      'im.chat.member.bot.added_v1': async (data) => {
        this.api.logger.info(`Bot added to chat: ${(data as any).chat_id}`);
      },
      'im.chat.member.bot.deleted_v1': async (data) => {
        this.api.logger.info(`Bot removed from chat: ${(data as any).chat_id}`);
      },
    });
  }

  /**
   * Handle incoming message
   */
  private async handleIncomingMessage(event: FeishuMessageEvent): Promise<void> {
    const messageId = event.message.message_id;

    // Deduplication check
    if (!tryRecordMessage('default', messageId)) {
      this.api.logger.debug(`Skipping duplicate message: ${messageId}`);
      return;
    }

    // Parse message
    const ctx = parseMessageEvent(event, this.botOpenId);
    const isGroup = ctx.chatType === 'group';

    this.api.logger.info(
      `Received ${isGroup ? 'group' : 'DM'} message from ${ctx.senderOpenId} in ${ctx.chatId}`
    );

    // Policy check
    if (isGroup) {
      const policy = checkGroupPolicy({
        config: this.config,
        chatId: ctx.chatId,
        senderOpenId: ctx.senderOpenId,
        mentionedBot: ctx.mentionedBot,
      });

      if (!policy.allowed) {
        this.api.logger.warn(`Message rejected: ${policy.reason}`);
        return;
      }

      if (policy.requireMention && !ctx.mentionedBot) {
        this.api.logger.debug('Skipping non-mention message in group');
        return;
      }
    } else {
      const policy = checkDMPolicy({
        config: this.config,
        senderOpenId: ctx.senderOpenId,
      });

      if (!policy.allowed) {
        this.api.logger.warn(`DM rejected: ${policy.reason}`);
        return;
      }
    }

    // Build session key
    const sessionKey = buildSessionKey({
      chatType: ctx.chatType,
      chatId: ctx.chatId,
      senderOpenId: ctx.senderOpenId,
      rootId: ctx.rootId,
      useTopicSession: false, // Can be configurable
    });

    // Resolve media
    const mediaMaxBytes = (this.config.mediaMaxMb || 30) * 1024 * 1024;
    const mediaList = await resolveFeishuMediaList({
      config: this.config,
      messageId: ctx.messageId,
      messageType: ctx.contentType,
      content: event.message.content,
      maxBytes: mediaMaxBytes,
      log: (msg) => this.api.logger.info(msg),
    });

    // Build message body
    let messageBody = ctx.content;
    const speaker = ctx.senderName || ctx.senderOpenId;
    messageBody = `${speaker}: ${messageBody}`;

    // Include media placeholders
    for (const media of mediaList) {
      messageBody += `\n${media.placeholder}`;
    }

    // Emit message received event
    this.api.emit('feishu:message', {
      sessionKey,
      agentId: this.defaultAgentId,
      from: `feishu:${ctx.senderOpenId}`,
      to: isGroup ? `chat:${ctx.chatId}` : `user:${ctx.senderOpenId}`,
      content: messageBody,
      rawContent: ctx.content,
      mediaPaths: mediaList.map((m) => m.path),
      mediaTypes: mediaList.map((m) => m.contentType),
      chatType: ctx.chatType,
      chatId: ctx.chatId,
      senderId: ctx.senderOpenId,
      messageId: ctx.messageId,
      replyToMessageId: ctx.parentId,
    });

    // Trigger hook
    await this.api.on('message_received', {
      from: `feishu:${ctx.senderOpenId}`,
      content: messageBody,
      channelId: 'feishu',
      sessionKey,
      metadata: {
        chatType: ctx.chatType,
        chatId: ctx.chatId,
        messageId: ctx.messageId,
        mediaPaths: mediaList.map((m) => m.path),
      },
    });
  }
}
