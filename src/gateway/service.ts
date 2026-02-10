import crypto from 'crypto';
import { watch, type FSWatcher } from 'fs';
import { dirname } from 'path';
import { AgentService } from '../agent/index.js';
import { ChannelManager } from '../channels/manager.js';
import { MessageBus } from '../bus/index.js';
import { loadConfig, saveConfig } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import type { Config } from '../config/schema.js';

const log = createLogger('GatewayService');

export interface GatewayServiceConfig {
  configPath?: string;
  enableHotReload?: boolean;
}

export class GatewayService {
  private bus: MessageBus;
  private config: Config;
  private configPath: string;
  private agentService: AgentService;
  private channelManager: ChannelManager;
  private running = false;
  private configWatcher: FSWatcher | null = null;
  private reloadDebounce: ReturnType<typeof setTimeout> | null = null;
  private startTime = Date.now();

  constructor(private serviceConfig: GatewayServiceConfig = {}) {
    this.bus = new MessageBus();
    this.configPath = serviceConfig.configPath || './config.json';
    this.config = loadConfig(this.configPath);

    // Initialize channel manager
    this.channelManager = new ChannelManager(this.config, this.bus);

    // Initialize agent service
    this.agentService = new AgentService(this.bus, {
      workspace: this.config.agents?.defaults?.workspace || './workspace',
      model: this.config.agents?.defaults?.model,
      braveApiKey: this.config.tools?.web?.search?.apiKey,
      config: this.config,
    });
  }

  async start(): Promise<void> {
    if (this.running) return;

    log.info('Starting gateway service...');
    this.startTime = Date.now();

    // Start channels
    await this.channelManager.startAll();

    // Start agent service (runs in background)
    this.agentService.start().catch((err) => {
      log.error({ err }, 'Agent service error');
    });

    // Setup config hot reload
    if (this.serviceConfig.enableHotReload !== false) {
      this.setupConfigWatcher();
    }

    this.running = true;
    log.info('Gateway service started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    log.info('Stopping gateway service...');

    // Stop config watcher
    if (this.configWatcher) {
      this.configWatcher.close();
      this.configWatcher = null;
    }

    if (this.reloadDebounce) {
      clearTimeout(this.reloadDebounce);
      this.reloadDebounce = null;
    }

    this.agentService.stop();
    await this.channelManager.stopAll();

    this.running = false;
    log.info('Gateway service stopped');
  }

  /**
   * Setup file watcher for config hot reload
   */
  private setupConfigWatcher(): void {
    try {
      const configDir = dirname(this.configPath);
      this.configWatcher = watch(configDir, (eventType, filename) => {
        if (filename && filename.endsWith('.json')) {
          // Debounce reload to avoid multiple rapid reloads
          if (this.reloadDebounce) {
            clearTimeout(this.reloadDebounce);
          }
          this.reloadDebounce = setTimeout(() => {
            this.reloadConfig().catch((err) => {
              log.error({ err }, 'Failed to reload config');
            });
          }, 500);
        }
      });
      log.debug({ configDir }, 'Config hot reload enabled');
    } catch (err) {
      log.warn({ err }, 'Failed to setup config watcher');
    }
  }

  /**
   * Reload configuration from disk
   */
  async reloadConfig(): Promise<{ reloaded: boolean; error?: string }> {
    try {
      log.info('Reloading configuration...');
      const newConfig = loadConfig(this.configPath);
      
      // Check if channels config changed
      const oldChannels = this.config.channels;
      const newChannels = newConfig.channels;
      
      // Update config
      this.config = newConfig;
      
      // TODO: Apply changes dynamically
      // For now we just log the change
      log.info('Configuration reloaded successfully');
      
      return { reloaded: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'Failed to reload config');
      return { reloaded: false, error };
    }
  }

  /**
   * Update configuration and persist to disk
   */
  async updateConfig(updates: Partial<Config>): Promise<{ updated: boolean; error?: string }> {
    try {
      log.info('Updating configuration...');
      
      // Merge updates
      this.config = { ...this.config, ...updates };
      
      // Save to disk
      saveConfig(this.config, this.configPath);
      
      log.info('Configuration updated successfully');
      return { updated: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'Failed to update config');
      return { updated: false, error };
    }
  }

  /**
   * Run agent with a message and stream events
   */
  async *runAgent(
    message: string,
    channel: string,
    chatId: string
  ): AsyncGenerator<{ type: string; content?: string; status?: string; runId?: string }, { status: string; summary: string }, unknown> {
    const runId = crypto.randomUUID();

    yield { type: 'status', status: 'accepted', runId };

    try {
      // Send message through bus
      await this.bus.publishInbound({
        channel,
        sender_id: 'gateway',
        chat_id: chatId,
        content: message,
      });

      // Wait for and collect response
      // This is simplified - in production we'd need proper session tracking
      yield { type: 'token', content: 'Processing...\\n' };

      // Simulate processing delay
      await new Promise((resolve) => setTimeout(resolve, 1000));

      yield { type: 'token', content: 'Done\\n' };

      return { status: 'ok', summary: 'Message processed' };
    } catch (error) {
      log.error({ err: error }, 'Agent run failed');
      throw error;
    }
  }

  /**
   * Send message through a channel
   */
  async sendMessage(
    channel: string,
    chatId: string,
    content: string
  ): Promise<{ sent: boolean; messageId?: string }> {
    try {
      await this.channelManager.send({
        channel,
        chat_id: chatId,
        content,
      });
      return { sent: true, messageId: `msg_${Date.now()}` };
    } catch (error) {
      log.error({ err: error, channel, chatId }, 'Failed to send message');
      throw error;
    }
  }

  /**
   * Get channel statuses
   */
  getChannelsStatus(): Array<{
    name: string;
    enabled: boolean;
    connected: boolean;
  }> {
    const allChannels = this.channelManager.getAllChannels();
    const runningChannels = new Set(this.channelManager.getRunningChannels());

    // Check which channels are configured
    const configChannels = [
      { name: 'telegram', enabled: !!this.config.channels?.telegram?.enabled },
      { name: 'whatsapp', enabled: !!this.config.channels?.whatsapp?.enabled },
    ];

    return configChannels.map((ch) => ({
      ...ch,
      connected: runningChannels.has(ch.name),
    }));
  }

  /**
   * Get health status
   */
  getHealth(): {
    status: string;
    service: string;
    version: string;
    uptime: number;
    channels: { running: number; total: number };
    configPath: string;
  } {
    const runningChannels = this.channelManager.getRunningChannels();
    const allChannels = this.channelManager.getAllChannels();

    return {
      status: 'ok',
      service: 'xopcbot-gateway',
      version: '0.1.0',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      channels: {
        running: runningChannels.length,
        total: allChannels.length,
      },
      configPath: this.configPath,
    };
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentConfig(): Config {
    return this.config;
  }
}
