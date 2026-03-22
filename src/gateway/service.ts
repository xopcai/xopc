import crypto from 'crypto';
import { join } from 'path';
import { AgentService } from '../agent/service.js';
import { ChannelManager } from '../channels/manager.js';
import { CHAT_CHANNEL_ORDER } from '../channels/registry.js';
import { MessageBus } from '../bus/index.js';
import { loadConfig, saveConfig } from '../config/index.js';
import { getWorkspacePath } from '../config/schema.js';
import { CronService } from '../cron/index.js';
import { ExtensionLoader, normalizeExtensionConfig } from '../extensions/index.js';
import type { ResolvedExtensionConfig } from '../extensions/types/index.js';
import { HeartbeatService } from '../heartbeat/index.js';
import { ConfigHotReloader } from '../config/reload.js';
import { SessionManager } from '../session/index.js';
import type { Config } from '../config/schema.js';
import type { SessionListQuery, ExportFormat } from '../types/index.js';
import { resolveGatewayAuth, assertGatewayAuthConfigured, validateToken, extractToken, type ResolvedGatewayAuth } from './auth.js';
import { getModelRegistry } from '../providers/index.js';
import { getLogDir, getLogStats, createLogger } from '../utils/logger.js';
import { resolveConfigPath, resolveCronJobsPath } from '../config/paths.js';
import { AgentRunRelay } from './agent-run-relay.js';

const log = createLogger('GatewayService');
import { registerAcpRuntimeBackend } from '../acp/runtime/registry.js';
import { createLocalAcpRuntimeBackend } from '../acp/runtime/backends/local.js';
import { buildSessionKey, parseSessionKey } from '../routing/session-key.js';

// ========== SSE Event System ==========

export interface ServiceEvent {
  id: string;
  type: string;
  payload: unknown;
}

type EventListener = (event: ServiceEvent) => Promise<void> | void;

const EVENT_BUFFER_SIZE = 200; // ring buffer per subscriber for Last-Event-ID replay

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
  private cronService: CronService;
  private extensionLoader: ExtensionLoader | null = null;
  private resolvedExtensionConfigs: ResolvedExtensionConfig[] = [];
  private heartbeatService: HeartbeatService;
  private sessionManager: SessionManager;
  private running = false;
  private configReloader: ConfigHotReloader | null = null;
  private startTime = Date.now();
  private workspacePath: string;

  // Authentication
  private auth: ResolvedGatewayAuth;

  // SSE event system
  private eventCounter = 0;
  private subscribers = new Map<string, EventListener>();
  private eventBuffers = new Map<string, ServiceEvent[]>();

  // Agent run relay for resuming SSE streams
  public readonly runRelay = new AgentRunRelay();

  constructor(private serviceConfig: GatewayServiceConfig = {}) {
    this.bus = new MessageBus();
    this.configPath = serviceConfig.configPath || resolveConfigPath();
    this.config = loadConfig(this.configPath);

    // Initialize authentication
    this.auth = resolveGatewayAuth({
      authConfig: this.config.gateway?.auth,
    });

    // Validate auth configuration
    assertGatewayAuthConfigured(this.auth);

    // Log token info (not the token itself)
    if (this.auth.mode === 'token') {
      const tokenPreview = this.auth.token ? `${this.auth.token.slice(0, 4)}***` : 'none';
      log.info({ mode: this.auth.mode, token: tokenPreview }, 'Authentication configured');
    } else {
      log.info({ mode: this.auth.mode }, 'Authentication disabled');
    }

    // Initialize channel manager
    this.channelManager = new ChannelManager(this.config, this.bus);

    // Initialize extension loader
    this.workspacePath = getWorkspacePath(this.config) || './workspace';
    this.initializeExtensionLoader();

    // Initialize ModelRegistry (loads from models.json)
    const registry = getModelRegistry();
    log.debug({ 
      modelCount: registry.getAll().length, 
      error: registry.getError() || 'none' 
    }, 'ModelRegistry initialized');

    // Initialize agent service with extension registry
    const modelConfig = this.config.agents?.defaults?.model;
    this.agentService = new AgentService(this.bus, {
      workspace: this.workspacePath,
      model: typeof modelConfig === 'string' ? modelConfig : modelConfig?.primary,
      braveApiKey: this.config.tools?.web?.search?.apiKey,
      config: this.config,
      extensionRegistry: this.extensionLoader?.getRegistry(),
    });

    // Set channel manager reference for model switching
    this.agentService.setChannelManager(this.channelManager);

    // Initialize cron service
    this.cronService = new CronService({
      filePath: resolveCronJobsPath(),
      agentService: this.agentService,
      messageBus: this.bus,
    });

    // Initialize session manager
    this.sessionManager = new SessionManager({
      workspace: this.workspacePath,
    });

    // Initialize heartbeat service
    this.heartbeatService = new HeartbeatService(this.cronService);
  }

  /**
   * Create extension loader and resolve configs (load runs in start() before channels).
   */
  private initializeExtensionLoader(): void {
    try {
      this.extensionLoader = new ExtensionLoader({
        workspaceDir: this.workspacePath,
        extensionsDir: join(this.workspacePath, '.extensions'),
      });
      this.extensionLoader.setConfig(this.config as Parameters<ExtensionLoader['setConfig']>[0]);

      const extensionsConfig = (this.config as Record<string, unknown>).extensions as
        | Record<string, unknown>
        | undefined;
      if (!extensionsConfig) {
        log.debug('No extensions config block; built-in channel plugins only');
        this.resolvedExtensionConfigs = [];
        return;
      }

      this.resolvedExtensionConfigs = normalizeExtensionConfig(extensionsConfig).filter((c) => c.enabled);
    } catch (error) {
      log.warn({ error }, 'Failed to initialize extension loader');
    }
  }

  /**
   * Load extensions and register SDK / full ChannelPlugin instances with ChannelManager.
   */
  private async loadExtensionsAndRegisterChannels(): Promise<void> {
    if (!this.extensionLoader) {
      return;
    }
    try {
      if (this.resolvedExtensionConfigs.length > 0) {
        await this.extensionLoader.loadExtensions(this.resolvedExtensionConfigs);
      }
      const reg = this.extensionLoader.getRegistry();
      for (const plugin of reg.channelPlugins) {
        this.channelManager.registerPlugin(plugin);
      }
      log.debug(
        {
          extensions: this.resolvedExtensionConfigs.length,
          channelPlugins: reg.channelPlugins.length,
        },
        'Extensions loaded and channel plugins registered',
      );
    } catch (err) {
      log.warn({ err }, 'Failed to load extensions');
    }
  }

  /**
   * Initialize ACP runtime backend
   */
  private async initializeAcpRuntime(): Promise<void> {
    try {
      // Check if ACP is enabled in config
      if (!this.config.acp?.enabled) {
        log.debug('ACP runtime disabled in config');
        return;
      }

      // Create and register local ACP runtime backend
      const backend = createLocalAcpRuntimeBackend(this.agentService, this.bus);
      registerAcpRuntimeBackend(backend);
      
      log.debug({ backendId: backend.id }, 'ACP runtime backend registered');
    } catch (error) {
      log.warn({ error }, 'Failed to initialize ACP runtime');
    }
  }

  async start(): Promise<void> {
    if (this.running) return;

    log.debug('Starting gateway service...');
    this.startTime = Date.now();
    this.running = true;

    this.channelManager.setOutboundHooks({
      runMessageSending: (to, content, channel) =>
        this.agentService.invokeOutboundMessageSending(to, content, channel),
      runMessageSent: (to, content, success, error, channel) =>
        this.agentService.invokeOutboundMessageSent(to, content, success, error, channel),
    });
    this.channelManager.enableOutboundPersistence(this.workspacePath);

    if (this.extensionLoader) {
      this.extensionLoader.setRuntimeContext({
        bus: this.bus,
        sessionManager: this.sessionManager,
      });
    }

    await this.loadExtensionsAndRegisterChannels();

    // Start channels (initialize first, then start)
    await this.channelManager.initializeChannels();
    await this.channelManager.startAll();
    await this.channelManager.replayPendingOutboundMessages();

    // Initialize session manager
    await this.sessionManager.initialize();
    log.debug('Session manager initialized');

    // Initialize ACP runtime backend
    await this.initializeAcpRuntime();

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

    log.debug('Gateway service started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    log.debug('Stopping gateway service...');

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
    log.debug('Gateway service stopped');
  }

  /**
   * Start processing outbound messages and send through channels
   */
  private async startOutboundProcessor(): Promise<void> {
    log.debug('Starting outbound message processor');
    while (this.running) {
      try {
        const msg = await this.bus.consumeOutbound();
        await this.channelManager.send(msg);
      } catch (error) {
        log.error({ error }, 'Error processing outbound message');
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
        onModelsReload: (newConfig) => this.handleModelsReload(newConfig),
        onAgentDefaultsReload: (newConfig) => this.handleAgentDefaultsReload(newConfig),
        onChannelsReload: (newConfig) => this.handleChannelsReload(newConfig),
        onCronReload: (newConfig) => this.handleCronReload(newConfig),
        onHeartbeatReload: (newConfig) => this.handleHeartbeatReload(newConfig),
        onToolsReload: (newConfig) => this.handleToolsReload(newConfig),
        onFullRestart: (newConfig) => {
          log.warn('Config changed requires full restart - please restart the gateway');
          this.config = newConfig;
          this.emit('config.reload', { section: 'full', requiresRestart: true });
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
   * Handle models config hot reload
   */
  private handleModelsReload(newConfig: Config): void {
    log.debug('Reloading models config...');
    this.config = newConfig;
    this.emit('config.reload', { section: 'models' });
    log.debug('Models config reloaded');
  }

  /**
   * Handle agent defaults config hot reload
   */
  private handleAgentDefaultsReload(newConfig: Config): void {
    log.debug('Reloading agent defaults...');
    this.config = newConfig;
    this.emit('config.reload', { section: 'agents' });
    log.debug('Agent defaults reloaded');
  }

  /**
   * Handle channels config hot reload
   */
  private async handleChannelsReload(newConfig: Config): Promise<void> {
    log.debug('Reloading channels config...');
    this.config = newConfig;
    await this.channelManager.updateConfig(newConfig);
    this.emit('config.reload', { section: 'channels' });
    this.emit('channels.status', { channels: this.getChannelsStatus() });
    log.debug('Channels config reloaded');
  }

  /**
   * Handle cron config hot reload
   */
  private handleCronReload(newConfig: Config): void {
    log.debug('Reloading cron config...');
    this.config = newConfig;
    this.cronService.updateConfig(newConfig);
    this.emit('config.reload', { section: 'cron' });
    log.debug('Cron config reloaded');
  }

  /**
   * Handle heartbeat config hot reload
   */
  private handleHeartbeatReload(newConfig: Config): void {
    log.debug('Reloading heartbeat config...');
    this.config = newConfig;
    this.heartbeatService.updateConfig(newConfig);
    this.emit('config.reload', { section: 'heartbeat' });
    log.debug('Heartbeat config reloaded');
  }

  /**
   * Handle tools config hot reload
   */
  private handleToolsReload(newConfig: Config): void {
    log.debug('Reloading tools config...');
    this.config = newConfig;
    this.emit('config.reload', { section: 'tools' });
    log.debug('Tools config reloaded');
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
   * Save current config to disk
   */
  async saveConfig(config: Config): Promise<{ saved: boolean; error?: string }> {
    try {
      await saveConfig(config, this.configPath);
      this.config = config;
      return { saved: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error({ error }, 'Failed to save config');
      return { saved: false, error };
    }
  }

  /**
   * Update configuration and persist to disk
   */
  async updateConfig(updates: Partial<Config>): Promise<{ updated: boolean; error?: string }> {
    try {
      log.debug('Updating configuration...');
      
      // Merge updates
      this.config = { ...this.config, ...updates };
      
      // Save to disk
      await saveConfig(this.config, this.configPath);
      
      log.debug('Configuration updated successfully');
      return { updated: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error({ error }, 'Failed to update config');
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
    }>,
    thinking?: string,
  ): AsyncGenerator<{ type: string; content?: string; status?: string; runId?: string }, { status: string; summary: string }, unknown> {
    const runId = crypto.randomUUID();

    // For webchat, register the run in the relay before yielding the first event
    if (channel === 'webchat') {
      const parsedKey = parseSessionKey(chatId);
      const sessionKey = parsedKey ? chatId : buildSessionKey({
        agentId: 'main',
        source: 'webchat',
        accountId: 'default',
        peerKind: 'direct',
        peerId: chatId,
      });
      this.runRelay.ensureRun(runId, sessionKey);
    }

    const statusEvent = { type: 'status', status: 'accepted', runId };
    if (channel === 'webchat') this.runRelay.publish(runId, statusEvent);
    yield statusEvent;

    try {
      // For 'webchat' channel (web UI), process through agent service
      if (channel === 'webchat') {
        // Determine session key: if chatId is already a valid session key, use it directly
        // Otherwise, build a new session key from the chatId
        const parsedKey = parseSessionKey(chatId);
        const sessionKey = parsedKey ? chatId : buildSessionKey({
          agentId: 'main',
          source: 'webchat',
          accountId: 'default',
          peerKind: 'direct',
          peerId: chatId,
        });

        // Fire-and-forget: save user message immediately so it survives page refresh
        this._saveUserMessage(sessionKey, message, attachments).catch((err) => {
          log.error({ err, sessionKey }, 'Failed to save user message');
        });
        
        try {
          const eventStream = this.agentService.processDirectStreaming(
            message, sessionKey, attachments, thinking
          );

          for await (const event of eventStream) {
            this.runRelay.publish(runId, event);
            yield event as { type: string; content?: string; status?: string; runId?: string };
          }

          this.runRelay.complete(runId);
          return { status: 'ok', summary: 'Message processed successfully' };
        } catch (error) {
          log.error({ error }, 'Agent processing failed');
          const errorEvent = { type: 'error', content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` };
          this.runRelay.publish(runId, errorEvent);
          this.runRelay.complete(runId);
          yield errorEvent;
          return { status: 'error', summary: error instanceof Error ? error.message : 'Unknown error' };
        }
      }

      // Send message through bus for other channels (telegram, etc.)
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
      log.error({ error }, 'Agent run failed');
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
      const messageId = `msg_${Date.now()}`;
      this.emit('message.sent', { channel, chatId, messageId });
      return { sent: true, messageId };
    } catch (error) {
      log.error({ channel, chatId, error }, 'Failed to send message');
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
    const channels = this.config.channels as Record<string, { enabled?: boolean } | undefined> | undefined;
    const builtinOrder = CHAT_CHANNEL_ORDER as readonly string[];

    const rows: Array<{ name: string; enabled: boolean; connected: boolean }> = CHAT_CHANNEL_ORDER.map(
      (name) => ({
        name,
        enabled: !!channels?.[name]?.enabled,
        connected: runningChannels.has(name),
      }),
    );

    const extReg = this.extensionLoader?.getRegistry();
    const extraIds = extReg?.channelPlugins.map((p) => p.id).filter((id) => !builtinOrder.includes(id)) ?? [];
    if (extraIds.length === 0) {
      return rows;
    }

    const seen = new Set(builtinOrder);
    for (const name of extraIds) {
      if (seen.has(name)) continue;
      seen.add(name);
      rows.push({
        name,
        enabled: channels?.[name]?.enabled !== false,
        connected: runningChannels.has(name),
      });
    }

    return rows;
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
    logs?: {
      dir: string;
      errors24h: number;
      stats: Record<string, number>;
    };
  } {
    const runningChannels = this.channelManager.getRunningChannels();
    const allChannels = this.channelManager.getAllChannels();
    const logStats = getLogStats();

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
      logs: {
        dir: getLogDir(),
        errors24h: logStats.errorsLast24h,
        stats: logStats.byLevel,
      },
    };
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Get extension registry for external access (HTTP routes, gateway methods)
   */
  getExtensionRegistry() {
    return this.extensionLoader?.getRegistry();
  }

  /**
   * Get model registry for external access (HTTP routes)
   */
  getModelRegistry() {
    const { getModelRegistry } = require('../providers/index.js');
    return getModelRegistry();
  }

  /**
   * Invoke a gateway method registered by extensions
   */
  async invokeGatewayMethod(method: string, params: Record<string, unknown>): Promise<unknown> {
    const registry = this.getExtensionRegistry();
    if (!registry) {
      throw new Error('Extension registry not available');
    }

    const handler = registry.getGatewayMethod(method);
    if (!handler) {
      throw new Error(`Gateway method not found: ${method}`);
    }

    // Merge context into params for backward compatibility
    const enhancedParams = {
      ...params,
      _senderId: params._senderId as string | undefined,
      _channel: params._channel as string | undefined,
    };

    return await handler(enhancedParams);
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

  // ========== SSE Event System ==========

  /**
   * Subscribe to server-pushed events.
   * Returns a cleanup function to unsubscribe.
   */
  subscribe(sessionId: string, listener: EventListener): () => void {
    this.subscribers.set(sessionId, listener);
    if (!this.eventBuffers.has(sessionId)) {
      this.eventBuffers.set(sessionId, []);
    }
    log.debug({ sessionId }, 'Event subscriber added');

    return () => {
      this.subscribers.delete(sessionId);
      // Keep buffer for a while in case they reconnect
      setTimeout(() => {
        if (!this.subscribers.has(sessionId)) {
          this.eventBuffers.delete(sessionId);
        }
      }, 5 * 60_000); // 5 min grace
      log.debug({ sessionId }, 'Event subscriber removed');
    };
  }

  /**
   * Emit an event to all subscribers.
   */
  emit(type: string, payload: unknown): void {
    const id = String(++this.eventCounter);
    const event: ServiceEvent = { id, type, payload };

    for (const [sessionId, listener] of this.subscribers) {
      // Buffer the event
      const buf = this.eventBuffers.get(sessionId) || [];
      buf.push(event);
      if (buf.length > EVENT_BUFFER_SIZE) buf.shift();
      this.eventBuffers.set(sessionId, buf);

      // Deliver
      try {
        listener(event);
      } catch (err) {
        log.warn({ sessionId, err }, 'Failed to deliver event to subscriber');
      }
    }
  }

  /**
   * Get events since a given event id (for Last-Event-ID reconnection).
   */
  getEventsSince(sessionId: string, lastEventId: string): ServiceEvent[] {
    const buf = this.eventBuffers.get(sessionId);
    if (!buf) return [];

    const idx = buf.findIndex((e) => e.id === lastEventId);
    if (idx === -1) return buf; // can't find cursor — send everything in buffer
    return buf.slice(idx + 1);
  }

  /**
   * Save user message to session for webchat (fire-and-forget).
   * Called at the start of runAgent to ensure message survives page refresh.
   */
  private async _saveUserMessage(
    sessionKey: string,
    message: string,
    attachments?: Array<{
      type: string;
      mimeType?: string;
      data?: string;
      name?: string;
      size?: number;
    }>,
  ): Promise<void> {
    // Load existing messages
    const existingMessages = await this.sessionManager.loadMessages(sessionKey);

    // Build user message
    const userMessage = {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: message }],
      attachments: attachments?.map(a => ({
        type: a.type,
        mimeType: a.mimeType,
        name: a.name,
        size: a.size,
        // Note: we don't store data (base64) to keep session file small
      })),
      timestamp: Date.now(),
    };

    // Append and save
    const updatedMessages = [...existingMessages, userMessage];
    await this.sessionManager.saveMessages(sessionKey, updatedMessages);
    log.debug({ sessionKey, messageCount: updatedMessages.length }, 'User message saved');
  }

  // ========== Session Management API ==========

  /**
   * List sessions with query filters
   */
  async listSessions(query?: SessionListQuery) {
    return this.sessionManager.listSessions(query);
  }

  /**
   * List all subagent sessions.
   * Subagent sessions have keys starting with 'subagent:'.
   */
  async listSubagents(query?: SessionListQuery) {
    return this.sessionManager.listSubagents(query);
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

  /**
   * Get unique chat IDs from sessions, grouped by channel
   * Returns a list of channel/chatId pairs for cron job configuration.
   * `chatId` is the session-store routing suffix (unique per bot account + peer).
   * When `routing` exists, `peerId` is the platform id (e.g. Telegram numeric chat id).
   */
  async getSessionChatIds(channel?: string): Promise<
    Array<{
      channel: string;
      chatId: string;
      lastActive: string;
      accountId?: string;
      peerKind?: string;
      peerId?: string;
    }>
  > {
    const result = await this.sessionManager.listSessions({
      limit: 1000,
      sortBy: 'lastAccessedAt',
      sortOrder: 'desc',
      ...(channel ? { channel } : {}),
    });

    // Group by channel:chatId to get unique pairs
    const seen = new Set<string>();
    const chatIds: Array<{
      channel: string;
      chatId: string;
      lastActive: string;
      accountId?: string;
      peerKind?: string;
      peerId?: string;
    }> = [];

    for (const session of result.items) {
      const key = `${session.sourceChannel}:${session.sourceChatId}`;
      if (!seen.has(key) && session.sourceChannel && session.sourceChatId) {
        seen.add(key);
        const r = session.routing;
        chatIds.push({
          channel: session.sourceChannel,
          chatId: session.sourceChatId,
          lastActive: session.lastAccessedAt,
          ...(r
            ? {
                accountId: r.accountId,
                peerKind: r.peerKind,
                peerId: r.peerId,
              }
            : {}),
        });
      }
    }

    return chatIds;
  }

  /**
   * Validate authentication token from request headers.
   * Returns true if auth is disabled (mode: 'none') or token is valid.
   */
  validateAuth(headers?: Record<string, string | string[] | undefined>): boolean {
    const token = extractToken(headers);
    return validateToken(this.auth, token);
  }

  /**
   * Get current auth mode.
   */
  getAuthMode(): 'none' | 'token' {
    return this.auth.mode;
  }

  /**
   * Get current auth token (for CLI server integration).
   * Returns undefined if mode is 'none'.
   */
  getAuthToken(): string | undefined {
    return this.auth.mode === 'token' ? this.auth.token : undefined;
  }

  /**
   * Refresh (regenerate) the gateway auth token.
   * Returns the new token.
   */
  async refreshAuthToken(): Promise<string> {
    if (this.auth.mode !== 'token') {
      throw new Error('Cannot refresh token: auth mode is not token');
    }

    // Generate new token
    const newToken = crypto.randomBytes(24).toString('hex');
    
    // Update in-memory auth
    this.auth.token = newToken;
    
    // Update config
    this.config = {
      ...this.config,
      gateway: {
        ...this.config.gateway,
        auth: {
          ...this.config.gateway?.auth,
          mode: 'token',
          token: newToken,
        },
      },
    };
    
    // Save to disk
    await saveConfig(this.config, this.configPath);
    
    log.info({ tokenPreview: `${newToken.slice(0, 8)}...` }, 'Gateway token refreshed');
    
    return newToken;
  }
}
