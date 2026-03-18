/**
 * Channel Manager - Channel plugin management based on ChannelPlugin interface
 */

import type { Config } from '../config/index.js';
import type { MessageBus } from '../bus/index.js';
import type { OutboundMessage } from '../types/index.js';
import type { 
  ChannelPlugin, 
  ChannelPluginInitOptions,
  ChannelPluginStartOptions,
  ChannelOutboundContext,
  OutboundDeliveryResult,
  ChannelStreamHandle,
} from './plugin-types.js';

import { createLogger } from '../utils/logger.js';
import { maybeApplyTtsToPayload } from '../tts/payload.js';

const log = createLogger('ChannelManager');

// ============================================
// Manager Implementation
// ============================================

export class ChannelManager {
  private plugins = new Map<string, ChannelPlugin>();
  private bus: MessageBus;
  private config: Config;
  private initialized = false;
  private running = false;
  
  constructor(config: Config, bus: MessageBus) {
    this.bus = bus;
    this.config = config;
  }
  
  registerPlugin(plugin: ChannelPlugin): void {
    if (this.plugins.has(plugin.id)) {
      log.warn({ channel: plugin.id }, 'Channel plugin already registered, overwriting');
    }
    this.plugins.set(plugin.id, plugin);
    log.debug({ channel: plugin.id }, 'Registered channel plugin');
  }
  
  getPlugin(id: string): ChannelPlugin | undefined {
    return this.plugins.get(id);
  }
  
  getAllPlugins(): ChannelPlugin[] {
    return Array.from(this.plugins.values());
  }
  
  async initialize(): Promise<void> {
    if (this.initialized) {
      log.warn('Channels already initialized');
      return;
    }
    
    const initPromises: Promise<void>[] = [];
    
    for (const [id, plugin] of this.plugins) {
      const channelConfig = this.config.channels?.[id];
      if (!channelConfig?.enabled) {
        log.debug({ channel: id }, 'Channel disabled in config, skipping');
        continue;
      }
      
      const initPromise = this.initializePlugin(plugin, channelConfig as Record<string, unknown>);
      initPromises.push(initPromise);
    }
    
    await Promise.allSettled(initPromises);
    this.initialized = true;
    log.info('All channel plugins initialized');
  }
  
  private async initializePlugin(
    plugin: ChannelPlugin, 
    channelConfig: Record<string, unknown>
  ): Promise<void> {
    try {
      const options: ChannelPluginInitOptions = {
        bus: this.bus,
        config: this.config,
        channelConfig,
      };
      await plugin.init(options);
      log.info({ channel: plugin.id }, 'Channel plugin initialized');
    } catch (err) {
      log.error({ channel: plugin.id, err }, 'Failed to initialize channel plugin');
    }
  }
  
  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error('Channels not initialized');
    }
    
    if (this.running) {
      log.warn('Channels already running');
      return;
    }
    
    const startPromises: Promise<void>[] = [];
    
    for (const [id, plugin] of this.plugins) {
      const channelConfig = this.config.channels?.[id];
      if (!channelConfig?.enabled) continue;
      
      const startPromise = this.startPlugin(plugin).catch(err => {
        log.error({ channel: id, err }, 'Failed to start channel plugin');
      });
      startPromises.push(startPromise);
    }
    
    await Promise.allSettled(startPromises);
    this.running = true;
    log.debug('All channel plugins started');
  }
  
  private async startPlugin(plugin: ChannelPlugin): Promise<void> {
    const options: ChannelPluginStartOptions = {};
    await plugin.start(options);
    log.info({ channel: plugin.id }, 'Channel plugin started');
  }
  
  async stop(): Promise<void> {
    if (!this.running) return;
    
    const stopPromises: Promise<void>[] = [];
    
    for (const [id, plugin] of this.plugins) {
      const stopPromise = this.stopPlugin(plugin).catch(err => {
        log.error({ channel: id, err }, 'Failed to stop channel plugin');
      });
      stopPromises.push(stopPromise);
    }
    
    await Promise.allSettled(stopPromises);
    this.running = false;
    log.info('All channel plugins stopped');
  }
  
  private async stopPlugin(plugin: ChannelPlugin): Promise<void> {
    await plugin.stop();
    log.info({ channel: plugin.id }, 'Channel plugin stopped');
  }
  
  async send(msg: OutboundMessage): Promise<void> {
    log.debug({ type: msg.type, channel: msg.channel, chatId: msg.chat_id }, 'Received outbound message');
    
    const processedMsg = await this.applyTtsIfNeeded(msg);
    
    const plugin = this.plugins.get(processedMsg.channel);
    if (!plugin) {
      log.error({ channel: processedMsg.channel }, 'Unknown channel');
      return;
    }
    
    // Handle typing indicators and other special message types
    if (processedMsg.type === 'typing_on' || processedMsg.type === 'typing_off') {
      log.debug({ type: processedMsg.type, channel: processedMsg.channel, chatId: processedMsg.chat_id }, 'Processing typing indicator');
      if (plugin.outbound.sendPayload) {
        await plugin.outbound.sendPayload({
          cfg: this.config,
          to: processedMsg.chat_id,
          text: processedMsg.content ?? '',
          mediaUrl: processedMsg.mediaUrl,
          threadId: processedMsg.metadata?.threadId as string | number | null,
          replyToId: processedMsg.replyToMessageId,
          accountId: processedMsg.metadata?.accountId as string ?? undefined,
          silent: processedMsg.silent,
          payload: processedMsg,
        });
        log.debug({ type: processedMsg.type, channel: processedMsg.channel, chatId: processedMsg.chat_id }, 'Sent typing indicator via payload');
      } else {
        log.warn({ channel: processedMsg.channel }, 'Plugin does not support sendPayload, cannot send typing indicator');
      }
      return;
    }
    
    if (!plugin.outbound?.sendText && !plugin.outbound?.sendPayload) {
      log.error({ channel: processedMsg.channel }, 'Channel does not support outbound');
      return;
    }
    
    const outboundCtx: ChannelOutboundContext = {
      cfg: this.config,
      to: processedMsg.chat_id,
      text: processedMsg.content ?? '',
      mediaUrl: processedMsg.mediaUrl,
      threadId: processedMsg.metadata?.threadId as string | number | null,
      replyToId: processedMsg.replyToMessageId,
      accountId: processedMsg.metadata?.accountId as string ?? undefined,
      silent: processedMsg.silent,
      audioAsVoice: processedMsg.audioAsVoice,
    };
    
    let result: OutboundDeliveryResult;
    
    if (plugin.outbound.sendPayload) {
      result = await plugin.outbound.sendPayload({ ...outboundCtx, payload: processedMsg });
    } else if (plugin.outbound.sendText) {
      result = await plugin.outbound.sendText(outboundCtx);
    } else {
      result = { messageId: '', chatId: processedMsg.chat_id, success: false, error: 'No send method' };
    }
    
    if (result.success) {
      log.info({ channel: processedMsg.channel, chatId: processedMsg.chat_id, messageId: result.messageId }, 'Message sent');
    } else {
      log.error({ channel: processedMsg.channel, chatId: processedMsg.chat_id, error: result.error }, 'Failed to send message');
    }
  }
  
  startStream(channel: string, chatId: string, accountId?: string): ChannelStreamHandle | null {
    const plugin = this.plugins.get(channel);
    if (!plugin) {
      log.error({ channel }, 'Unknown channel');
      return null;
    }
    
    return (plugin as any).startStream?.({ chatId, accountId }) ?? null;
  }
  
  async getChannelStatus(channel: string): Promise<Record<string, unknown>> {
    const plugin = this.plugins.get(channel);
    if (!plugin) return { error: 'Unknown channel' };
    
    if (!plugin.status?.buildChannelSummary) return { status: 'unknown' };
    
    try {
      const accountId = (plugin as any).configAdapter?.listAccountIds(this.config)[0] ?? 'default';
      const account = (plugin as any).configAdapter?.resolveAccount(this.config, accountId);
      
      const summary = await plugin.status.buildChannelSummary({
        account,
        cfg: this.config,
        defaultAccountId: accountId,
        snapshot: plugin.status.defaultRuntime ?? { accountId, channelId: channel, enabled: true, configured: true },
      });
      return summary;
    } catch (err) {
      return { error: String(err) };
    }
  }
  
  updateConfig(config: Config): void {
    this.config = config;
    log.info('Channel config updated');
  }
  
  private async applyTtsIfNeeded(msg: OutboundMessage): Promise<OutboundMessage> {
    if (msg.type && msg.type !== 'message') return msg;
    if (!msg.content?.trim()) return msg;
    if (msg.mediaUrl) return msg;
    
    const ttsConfig = this.config.tts ?? { enabled: false, provider: 'openai' as const, trigger: 'always' as const };
    if (!ttsConfig.enabled) return msg;
    
    const inboundAudio = msg.metadata?.transcribedVoice === true;
    return maybeApplyTtsToPayload(msg, { config: ttsConfig, channel: msg.channel, inboundAudio });
  }
  
  // Aliases for backward compatibility
  async initializeChannels(): Promise<void> {
    return this.initialize();
  }
  
  async startAll(): Promise<void> {
    return this.start();
  }
  
  async stopAll(): Promise<void> {
    return this.stop();
  }
  
  getRunningChannels(): string[] {
    return Array.from(this.plugins.keys());
  }
  
  getAllChannels(): ChannelPlugin[] {
    return this.getAllPlugins();
  }
}

export function createChannelManager(config: Config, bus: MessageBus): ChannelManager {
  return new ChannelManager(config, bus);
}
