import crypto from 'crypto';
import { join } from 'path';
import { AgentService } from '../agent/index.js';
import { ChannelManager } from '../channels/manager.js';
import { MessageBus } from '../bus/index.js';
import { loadConfig, saveConfig, DEFAULT_PATHS } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { CronService, DefaultJobExecutor } from '../cron/index.js';
import { PluginLoader, normalizePluginConfig } from '../plugins/index.js';
import { HeartbeatService } from '../heartbeat/index.js';
import { ConfigHotReloader } from '../config/reload.js';
import { SessionManager } from '../session/index.js';
import type { Config } from '../config/schema.js';
import type { JobData } from '../cron/types.js';
import type { SessionListQuery, ExportFormat } from '../types/index.js';

const log = createLogger('GatewayService');

export interface GatewayServiceConfig {
  configPath?: string;
  enableHotReload?: boolean;
}

class MessageJobExecutor extends DefaultJobExecutor {
  constructor(private channelManager: ChannelManager) {
    super();
  }

  protected async performJob(job: JobData, _signal: AbortSignal): Promise<void> {
    // Send the scheduled message through the appropriate channel
    // Parse channel and chat_id from job message format: "channel:chat_id:message"
    const parts = job.message.split(':', 3);
    if (parts.length >= 3) {
      const [channel, chatId, ...messageParts] = parts;
      const content = messageParts.join(':');
      
      await this.channelManager.send({
        channel,
        chat_id: chatId,
        content,
      });
    } else {
      // Fallback: send as is
      log.warn({ jobId: job.id }, 'Job message format invalid, expected "channel:chat_id:message"');
    }
  }
}

export class GatewayService {
  private bus: MessageBus;
  private config: Config;
  private configPath: string;
  private agentService: AgentService;
  private channelManager: ChannelManager;
  private cronService: CronService;
  private pluginLoader: PluginLoader | null = null;
  private heartbeatService: HeartbeatService;
  private sessionManager: SessionManager;
  private running = false;
  private configReloader: ConfigHotReloader | null = null;
  private startTime = Date.now();

  constructor(private serviceConfig: GatewayServiceConfig = {}) {
    this.bus = new MessageBus();
    this.configPath = serviceConfig.configPath || DEFAULT_PATHS.config;
    this.config = loadConfig(this.configPath);

    // Initialize channel manager
    this.channelManager = new ChannelManager(this.config, this.bus);

    // Initialize plugin loader
    this.initializePlugins();

    // Initialize agent service with plugin registry
    const modelConfig = this.config.agents?.defaults?.model;
    this.agentService = new AgentService(this.bus, {
      workspace: this.config.agents?.defaults?.workspace || './workspace',
      model: typeof modelConfig === 'string' ? modelConfig : modelConfig?.primary,
      braveApiKey: this.config.tools?.web?.search?.apiKey,
      config: this.config,
      pluginRegistry: this.pluginLoader?.getRegistry(),
    });

    // Initialize cron service with custom executor
    const cronExecutor = new MessageJobExecutor(this.channelManager);
    this.cronService = new CronService(
      DEFAULT_PATHS.cronJobs,
      cronExecutor
    );

    // Initialize session manager
    this.sessionManager = new SessionManager({
      workspace: this.config.agents?.defaults?.workspace || './workspace',
    });

    // Initialize heartbeat service
    this.heartbeatService = new HeartbeatService(this.cronService);
  }

  /**
   * Initialize plugins from config
   */
  private initializePlugins(): void {
    try {
      const pluginsConfig = (this.config as any).plugins;
      if (!pluginsConfig) {
        log.debug('No plugins configured');
        return;
      }

      const resolvedConfigs = normalizePluginConfig(pluginsConfig);
      
      this.pluginLoader = new PluginLoader({
        workspaceDir: this.config.agents?.defaults?.workspace || './workspace',
        pluginsDir: join(this.config.agents?.defaults?.workspace || './workspace', '.plugins'),
      });

      // Load enabled plugins
      const enabledPlugins = resolvedConfigs.filter(c => c.enabled);
      if (enabledPlugins.length > 0) {
        this.pluginLoader.loadPlugins(enabledPlugins).then(() => {
          log.info({ count: enabledPlugins.length }, 'Plugins loaded');
        }).catch(err => {
          log.warn({ err }, 'Failed to load some plugins');
        });
      }
    } catch (error) {
      log.warn({ err: error }, 'Failed to initialize plugins');
    }
  }

  async start(): Promise<void> {
    if (this.running) return;

    log.info('Starting gateway service...');
    this.startTime = Date.now();
    this.running = true;

    // Start channels
    await this.channelManager.startAll();

    // Initialize session manager
    await this.sessionManager.initialize();
    log.info('Session manager initialized');

    // Start cron service
    if (this.config.cron?.enabled !== false) {
      await this.cronService.initialize();
    }

    // Start heartbeat service
    const heartbeatConfig = this.config.gateway?.heartbeat;
    this.heartbeatService.start({
      intervalMs: heartbeatConfig?.intervalMs || 60000,
      enabled: heartbeatConfig?.enabled ?? true,
    });

    // Start agent service (runs in background)
    this.agentService.start().catch((err) => {
      log.error({ err }, 'Agent service error');
    });

    // Start outbound message processor
    this.startOutboundProcessor().catch((err) => {
      log.error({ err }, 'Outbound processor error');
    });

    // Setup config hot reload
    if (this.serviceConfig.enableHotReload !== false) {
      this.setupConfigReloader();
    }

    log.info('Gateway service started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    log.info('Stopping gateway service...');

    // Stop config reloader
    if (this.configReloader) {
      await this.configReloader.stop();
      this.configReloader = null;
    }

    // Stop heartbeat service
    this.heartbeatService.stop();

    this.agentService.stop();
    await this.channelManager.stopAll();
    
    // Stop cron service
    await this.cronService.stop();

    this.running = false;
    log.info('Gateway service stopped');
  }

  /**
   * Start processing outbound messages and send through channels
   */
  private async startOutboundProcessor(): Promise<void> {
    log.info('Starting outbound message processor');
    while (this.running) {
      try {
        const msg = await this.bus.consumeOutbound();
        await this.channelManager.send(msg);
      } catch (error) {
        log.error({ err: error }, 'Error processing outbound message');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Setup config hot reload using ConfigHotReloader
   */
  private setupConfigReloader(): void {
    this.configReloader = new ConfigHotReloader(
      this.configPath,
      this.config,
      {
        onProvidersReload: (newConfig) => this.handleProvidersReload(newConfig),
        onAgentDefaultsReload: (newConfig) => this.handleAgentDefaultsReload(newConfig),
        onChannelsReload: (newConfig) => this.handleChannelsReload(newConfig),
        onCronReload: (newConfig) => this.handleCronReload(newConfig),
        onHeartbeatReload: (newConfig) => this.handleHeartbeatReload(newConfig),
        onToolsReload: (newConfig) => this.handleToolsReload(newConfig),
        onFullRestart: (newConfig) => {
          log.warn('Config changed requires full restart - please restart the gateway');
          this.config = newConfig;
        },
      },
      {
        debounceMs: 300,
        enabled: this.serviceConfig.enableHotReload !== false,
      }
    );
    this.configReloader.start();
  }

  /**
   * Handle providers config hot reload
   */
  private handleProvidersReload(newConfig: Config): void {
    log.info('Reloading providers config...');
    this.config = newConfig;
    // TODO: Re-initialize provider clients with new API keys
    log.info('Providers config reloaded');
  }

  /**
   * Handle agent defaults config hot reload
   */
  private handleAgentDefaultsReload(newConfig: Config): void {
    log.info('Reloading agent defaults...');
    this.config = newConfig;
    // Agent model/temperature changes will apply on next request
    log.info('Agent defaults reloaded');
  }

  /**
   * Handle channels config hot reload
   */
  private handleChannelsReload(newConfig: Config): void {
    log.info('Reloading channels config...');
    this.config = newConfig;
    // Re-initialize channels
    this.channelManager.updateConfig(newConfig);
    log.info('Channels config reloaded');
  }

  /**
   * Handle cron config hot reload
   */
  private handleCronReload(newConfig: Config): void {
    log.info('Reloading cron config...');
    this.config = newConfig;
    // Reload cron jobs
    this.cronService.updateConfig(newConfig);
    log.info('Cron config reloaded');
  }

  /**
   * Handle heartbeat config hot reload
   */
  private handleHeartbeatReload(newConfig: Config): void {
    log.info('Reloading heartbeat config...');
    this.config = newConfig;
    // Reload heartbeat service
    this.heartbeatService.updateConfig(newConfig);
    log.info('Heartbeat config reloaded');
  }

  /**
   * Handle tools config hot reload
   */
  private handleToolsReload(newConfig: Config): void {
    log.info('Reloading tools config...');
    this.config = newConfig;
    // TODO: Reload tools configuration
    log.info('Tools config reloaded');
  }

  /**
   * Reload configuration from disk (manual trigger)
   */
  async reloadConfig(): Promise<{ reloaded: boolean; error?: string }> {
    if (!this.configReloader) {
      return { reloaded: false, error: 'Config reloader not initialized' };
    }
    const result = await this.configReloader.triggerReload();
    return { reloaded: result.success, error: result.error };
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
    chatId: string,
    attachments?: Array<{
      type: string;
      mimeType?: string;
      data?: string;
      name?: string;
      size?: number;
    }>
  ): AsyncGenerator<{ type: string; content?: string; status?: string; runId?: string }, { status: string; summary: string }, unknown> {
    const runId = crypto.randomUUID();

    yield { type: 'status', status: 'accepted', runId };

    try {
      // For 'gateway' channel (web UI), process through agent service
      if (channel === 'gateway') {
        const sessionKey = `gateway:${chatId}`;
        
        yield { type: 'token', content: 'Thinking...\n' };
        
        try {
          // Process message through the LLM (with attachments if provided)
          const response = await this.agentService.processDirect(message, sessionKey, attachments);
          
          yield { type: 'token', content: response };
          
          return { status: 'ok', summary: 'Message processed successfully' };
        } catch (error) {
          log.error({ err: error }, 'Agent processing failed');
          yield { type: 'error', content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` };
          return { status: 'error', summary: error instanceof Error ? error.message : 'Unknown error' };
        }
      }

      // Send message through bus for other channels (telegram, whatsapp, etc.)
      await this.bus.publishInbound({
        channel,
        sender_id: 'gateway',
        chat_id: chatId,
        content: message,
      });

      // Wait for and collect response
      // This is simplified - in production we'd need proper session tracking
      yield { type: 'token', content: 'Processing...\n' };

      // Simulate processing delay
      await new Promise((resolve) => setTimeout(resolve, 1000));

      yield { type: 'token', content: 'Done\n' };

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

  get cronServiceInstance(): CronService {
    return this.cronService;
  }

  get sessionManagerInstance(): SessionManager {
    return this.sessionManager;
  }

  /**
   * Process a message directly through the agent (for CLI mode)
   */
  async processDirect(content: string, sessionKey = 'cli:direct'): Promise<string> {
    return this.agentService.processDirect(content, sessionKey);
  }

  // ========== Session Management API ==========

  /**
   * List sessions with query filters
   */
  async listSessions(query?: SessionListQuery) {
    return this.sessionManager.listSessions(query);
  }

  /**
   * Get a single session by key
   */
  async getSession(key: string) {
    return this.sessionManager.getSession(key);
  }

  /**
   * Delete a session
   */
  async deleteSession(key: string): Promise<{ deleted: boolean }> {
    const result = await this.sessionManager.deleteSession(key);
    return { deleted: result };
  }

  /**
   * Delete multiple sessions
   */
  async deleteSessions(keys: string[]): Promise<{ success: string[]; failed: string[] }> {
    return this.sessionManager.deleteSessions(keys);
  }

  /**
   * Rename a session
   */
  async renameSession(key: string, name: string): Promise<{ renamed: boolean }> {
    await this.sessionManager.renameSession(key, name);
    return { renamed: true };
  }

  /**
   * Tag a session
   */
  async tagSession(key: string, tags: string[]): Promise<{ tagged: boolean }> {
    await this.sessionManager.tagSession(key, tags);
    return { tagged: true };
  }

  /**
   * Remove tags from a session
   */
  async untagSession(key: string, tags: string[]): Promise<{ untagged: boolean }> {
    await this.sessionManager.untagSession(key, tags);
    return { untagged: true };
  }

  /**
   * Archive a session
   */
  async archiveSession(key: string): Promise<{ archived: boolean }> {
    await this.sessionManager.archiveSession(key);
    return { archived: true };
  }

  /**
   * Unarchive a session
   */
  async unarchiveSession(key: string): Promise<{ unarchived: boolean }> {
    await this.sessionManager.unarchiveSession(key);
    return { unarchived: true };
  }

  /**
   * Pin a session
   */
  async pinSession(key: string): Promise<{ pinned: boolean }> {
    await this.sessionManager.pinSession(key);
    return { pinned: true };
  }

  /**
   * Unpin a session
   */
  async unpinSession(key: string): Promise<{ unpinned: boolean }> {
    await this.sessionManager.unpinSession(key);
    return { unpinned: true };
  }

  /**
   * Search sessions
   */
  async searchSessions(query: string) {
    return this.sessionManager.searchSessions(query);
  }

  /**
   * Search within a session
   */
  async searchInSession(key: string, keyword: string) {
    return this.sessionManager.searchInSession(key, keyword);
  }

  /**
   * Export a session
   */
  async exportSession(key: string, format: ExportFormat): Promise<{ content: string }> {
    const content = await this.sessionManager.exportSession(key, format);
    return { content };
  }

  /**
   * Get session statistics
   */
  async getSessionStats() {
    return this.sessionManager.getStats();
  }
}
