/**
 * Channel Manager - Channel plugin management based on ChannelPlugin interface
 */

import type { Config } from '../config/index.js';
import type { MessageBus } from '../infra/bus/index.js';
import type { OutboundMessage } from './transport-types.js';
import type {
  ChannelPlugin,
  ChannelPluginInitOptions,
  ChannelPluginSessionModelHooks,
  ChannelPluginStartOptions,
  ChannelStreamHandle,
} from './plugin-types.js';

import { createLogger } from '../utils/logger.js';
import { maybeApplyTtsToPayload } from '../tts/payload.js';
import { deliverOutboundMessage } from './outbound/deliver.js';
import { OutboundPersistStore } from './outbound/persist-store.js';
import { syncChannelPluginsFromManager } from './plugins/registry.js';
import { CHANNEL_RESTART_POLICY, computeBackoff } from './restart-policy.js';
import { ChannelHealthMonitor, type ChannelHealthState } from './health-monitor.js';

const log = createLogger('ChannelManager');

function asChannelConfig(raw: unknown): Record<string, unknown> | undefined {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return undefined;
}

/** Hooks wired from AgentService for `message_sending` / `message_sent` on outbound delivery. */
export interface OutboundChannelHooks {
  runMessageSending: (
    to: string,
    content: string,
    channel: string,
  ) => Promise<{ send: boolean; content?: string; reason?: string }>;
  runMessageSent: (
    to: string,
    content: string,
    success: boolean,
    error: string | undefined,
    channel: string,
  ) => Promise<void>;
}

// ============================================
// Manager Implementation
// ============================================

export class ChannelManager {
  private plugins = new Map<string, ChannelPlugin>();
  /** Plugins that completed `init()` successfully (skipped channels are not listed). */
  private initializedPluginIds = new Set<string>();
  private bus: MessageBus;
  private config: Config;
  private initialized = false;
  private running = false;
  private restartAttempts = new Map<string, number>();
  /** When set, failed-start auto-restart is suppressed for that channel id. */
  private manuallyStopped = new Set<string>();
  private heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();
  private outboundHooks?: OutboundChannelHooks;
  private persistStore?: OutboundPersistStore;
  private _lastHeartbeatRestartAt = new Map<string, number>();
  private readonly healthMonitor = new ChannelHealthMonitor();
  private sessionModelHooks?: ChannelPluginSessionModelHooks;

  constructor(config: Config, bus: MessageBus) {
    this.bus = bus;
    this.config = config;
  }
  
  setOutboundHooks(hooks: OutboundChannelHooks): void {
    this.outboundHooks = hooks;
  }

  /** Call before `initialize()` so plugins can persist per-session model overrides (e.g. Telegram /models UI). */
  setSessionModelHooks(hooks: ChannelPluginSessionModelHooks | undefined): void {
    this.sessionModelHooks = hooks;
  }

  enableOutboundPersistence(workspaceDir: string): void {
    this.persistStore = new OutboundPersistStore(workspaceDir);
  }

  /**
   * Redeliver persisted outbound items (after channels are started). Best-effort; may duplicate if prior send succeeded but ack did not.
   */
  async replayPendingOutboundMessages(): Promise<void> {
    if (!this.persistStore) return;
    const pending = [...this.persistStore.peek()];
    for (const p of pending) {
      try {
        await this.send(p.message, { skipPersist: true });
        this.persistStore.ack(p.id);
      } catch (err) {
        log.error({ id: p.id, err }, 'Failed to replay outbound message');
      }
    }
  }

  registerPlugin(plugin: ChannelPlugin): void {
    if (this.plugins.has(plugin.id)) {
      log.warn({ channel: plugin.id }, 'Channel plugin already registered, overwriting');
    }
    this.plugins.set(plugin.id, plugin);
    syncChannelPluginsFromManager(this.getAllPlugins());
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
      const channelConfig = asChannelConfig(this.config.channels?.[id]);
      if (!this.shouldRunChannelPlugin(plugin, channelConfig)) {
        log.debug({ channel: id }, 'Channel disabled in config, skipping');
        continue;
      }

      const initPromise = this.initializePlugin(
        plugin,
        channelConfig ?? {},
      );
      initPromises.push(initPromise);
    }
    
    await Promise.allSettled(initPromises);
    this.initialized = true;
    log.info('All channel plugins initialized');
  }
  
  /**
   * Builtin channels require `channels.<id>.enabled`. Extension-managed channels run unless explicitly disabled.
   */
  private shouldRunChannelPlugin(
    plugin: ChannelPlugin,
    channelConfig: Record<string, unknown> | undefined,
  ): boolean {
    if (plugin.extensionManagedConfig) {
      return channelConfig?.enabled !== false;
    }
    return !!channelConfig?.enabled;
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
        sessionModel: this.sessionModelHooks,
      };
      await plugin.init(options);
      this.initializedPluginIds.add(plugin.id);
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
      const channelConfig = asChannelConfig(this.config.channels?.[id]);
      if (!this.shouldRunChannelPlugin(plugin, channelConfig)) continue;

      const startPromise = this.startPlugin(plugin, {}).catch((err) => {
        log.error({ channel: id, err }, 'Failed to start channel plugin');
      });
      startPromises.push(startPromise);
    }
    
    await Promise.allSettled(startPromises);
    this.running = true;
    log.debug('All channel plugins started');
  }
  
  private async startPlugin(
    plugin: ChannelPlugin,
    opts: { preserveRestartAttempts?: boolean },
  ): Promise<void> {
    const options: ChannelPluginStartOptions = {};
    try {
      await plugin.start(options);
      if (!opts.preserveRestartAttempts) {
        this.restartAttempts.delete(plugin.id);
      }
      this._scheduleHeartbeat(plugin);
      log.info({ channel: plugin.id }, 'Channel plugin started');
    } catch (err) {
      const attempt = (this.restartAttempts.get(plugin.id) ?? 0) + 1;
      this.restartAttempts.set(plugin.id, attempt);
      if (attempt <= CHANNEL_RESTART_POLICY.maxAttempts) {
        const delayMs = computeBackoff(CHANNEL_RESTART_POLICY, attempt);
        log.warn(
          { channel: plugin.id, attempt, delayMs, err },
          'Channel failed to start, scheduling restart',
        );
        setTimeout(() => {
          if (this.manuallyStopped.has(plugin.id)) {
            log.debug({ channel: plugin.id }, 'Skipping scheduled restart (manual stop)');
            return;
          }
          void this.startPlugin(plugin, { preserveRestartAttempts: true }).catch((e) => {
            log.error({ channel: plugin.id, err: e }, 'Channel restart attempt failed');
          });
        }, delayMs);
      } else {
        log.error({ channel: plugin.id, err }, 'Channel exceeded max restart attempts');
      }
    }
  }
  
  async stop(): Promise<void> {
    if (!this.running) return;
    
    const stopPromises: Promise<void>[] = [];
    
    for (const id of this.initializedPluginIds) {
      const plugin = this.plugins.get(id);
      if (!plugin) continue;
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
    this._clearHeartbeatTimers(plugin.id);
    await plugin.stop();
    log.info({ channel: plugin.id }, 'Channel plugin stopped');
  }

  private _clearHeartbeatTimers(pluginId: string): void {
    const prefix = `${pluginId}:`;
    for (const key of [...this.heartbeatTimers.keys()]) {
      if (key.startsWith(prefix)) {
        clearInterval(this.heartbeatTimers.get(key)!);
        this.heartbeatTimers.delete(key);
      }
    }
  }

  private _scheduleHeartbeat(plugin: ChannelPlugin): void {
    const hb = plugin.heartbeat;
    if (!hb) return;
    this._clearHeartbeatTimers(plugin.id);
    let accountIds: string[] = [];
    try {
      accountIds = plugin.config.listAccountIds(this.config);
    } catch (e) {
      log.warn({ channel: plugin.id, err: e }, 'Heartbeat: failed to list accounts');
      return;
    }
    for (const accountId of accountIds) {
      const key = `${plugin.id}:${accountId}`;
      const timer = setInterval(() => {
        void (async () => {
          try {
            const r = await hb.check({ cfg: this.config, accountId });
            this.healthMonitor.set(plugin.id, accountId, {
              healthy: r.healthy,
              lastCheckAt: Date.now(),
              detail:
                typeof r.details === 'string'
                  ? r.details
                  : r.details != null
                    ? JSON.stringify(r.details)
                    : undefined,
            });
            if (!r.healthy) {
              log.warn(
                { channel: plugin.id, accountId, detail: r.details },
                'Channel heartbeat unhealthy',
              );
              const now = Date.now();
              const last = this._lastHeartbeatRestartAt.get(plugin.id) ?? 0;
              if (now - last < 60_000) {
                return;
              }
              this._lastHeartbeatRestartAt.set(plugin.id, now);
              void this._softRestartChannel(plugin.id);
            }
          } catch (err) {
            this.healthMonitor.set(plugin.id, accountId, {
              healthy: false,
              lastCheckAt: Date.now(),
              detail: err instanceof Error ? err.message : String(err),
            });
            log.error({ channel: plugin.id, accountId, err }, 'Channel heartbeat check failed');
          }
        })();
      }, hb.intervalMs);
      this.heartbeatTimers.set(key, timer);
    }
  }

  private async _softRestartChannel(channelId: string): Promise<void> {
    if (this.manuallyStopped.has(channelId)) return;
    const plugin = this.plugins.get(channelId);
    if (!plugin || !this.initializedPluginIds.has(channelId)) return;
    this._clearHeartbeatTimers(channelId);
    try {
      await plugin.stop();
      await this.startPlugin(plugin, {});
    } catch (err) {
      log.error({ channel: channelId, err }, 'Channel soft restart after heartbeat failed');
    }
  }

  private cloneOutbound(m: OutboundMessage): OutboundMessage {
    return structuredClone(m);
  }
  
  async send(msg: OutboundMessage, options?: { skipPersist?: boolean }): Promise<void> {
    log.debug({ type: msg.type, channel: msg.channel, chatId: msg.chat_id }, 'Received outbound message');

    let processedMsg = await this.applyTtsIfNeeded(msg);
    const queueId =
      !options?.skipPersist && this.persistStore ? this.persistStore.enqueue(this.cloneOutbound(processedMsg)) : null;

    try {
      if (this.outboundHooks) {
        const hookResult = await this.outboundHooks.runMessageSending(
          processedMsg.chat_id,
          processedMsg.content ?? '',
          processedMsg.channel,
        );
        if (!hookResult.send) {
          if (queueId) this.persistStore!.ack(queueId);
          return;
        }
        processedMsg = { ...processedMsg, content: hookResult.content ?? processedMsg.content };
      }

      const plugin = this.plugins.get(processedMsg.channel);
      if (!plugin?.outbound) {
        log.error({ channel: processedMsg.channel }, 'Unknown channel or no outbound adapter');
        if (queueId) this.persistStore!.ack(queueId);
        return;
      }

      const result = await deliverOutboundMessage({
        cfg: this.config,
        plugin,
        processedMsg,
      });

      if (this.outboundHooks) {
        const err = result && !result.success ? result.error : undefined;
        await this.outboundHooks.runMessageSent(
          processedMsg.chat_id,
          processedMsg.content ?? '',
          result?.success ?? false,
          err,
          processedMsg.channel,
        );
      }

      if (!result) {
        if (queueId) this.persistStore!.ack(queueId);
        return;
      }

      if (result.success) {
        log.info(
          { channel: processedMsg.channel, chatId: processedMsg.chat_id, messageId: result.messageId },
          'Message sent',
        );
      } else {
        log.error(
          { channel: processedMsg.channel, chatId: processedMsg.chat_id, error: result.error },
          'Failed to send message',
        );
      }

      if (queueId) this.persistStore!.ack(queueId);
    } catch (err) {
      log.error(
        { channel: processedMsg.channel, chatId: processedMsg.chat_id, err },
        'Outbound send threw',
      );
      if (!queueId) throw err;
    }
  }
  
  startStream(
    channel: string,
    chatId: string,
    accountId?: string,
    opts?: { threadId?: string; replyToMessageId?: string },
  ): ChannelStreamHandle | null {
    const plugin = this.plugins.get(channel);
    if (!plugin) {
      log.error({ channel }, 'Unknown channel');
      return null;
    }

    return (
      plugin.streaming?.startStream?.({
        chatId,
        accountId,
        threadId: opts?.threadId,
        replyToMessageId: opts?.replyToMessageId,
      }) ?? null
    );
  }
  
  async getChannelStatus(channel: string): Promise<Record<string, unknown>> {
    const plugin = this.plugins.get(channel);
    if (!plugin) return { error: 'Unknown channel' };
    
    if (!plugin.status?.buildChannelSummary) return { status: 'unknown' };

    try {
      const accountId = plugin.config.listAccountIds(this.config)[0] ?? 'default';
      const account = plugin.config.resolveAccount(this.config, accountId);
      
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
  
  async updateConfig(config: Config): Promise<void> {
    this.config = config;
    for (const id of this.initializedPluginIds) {
      const plugin = this.plugins.get(id);
      if (plugin?.onConfigUpdated) {
        await Promise.resolve(plugin.onConfigUpdated(config));
      }
    }
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

  /**
   * Stop a single channel and suppress automatic restart until `startChannel` is called.
   */
  async stopChannel(channelId: string): Promise<void> {
    this.manuallyStopped.add(channelId);
    const plugin = this.plugins.get(channelId);
    if (!plugin || !this.initializedPluginIds.has(channelId)) {
      return;
    }
    await this.stopPlugin(plugin).catch((err) => {
      log.error({ channel: channelId, err }, 'Failed to stop channel plugin');
    });
  }

  /**
   * Clear manual-stop and start one channel (requires prior `initializeChannels` / init).
   */
  async startChannel(channelId: string): Promise<void> {
    this.manuallyStopped.delete(channelId);
    const plugin = this.plugins.get(channelId);
    if (!plugin) {
      log.warn({ channel: channelId }, 'Unknown channel');
      return;
    }
    if (!this.initialized) {
      log.warn({ channel: channelId }, 'Channels not initialized');
      return;
    }
    const channelConfig = asChannelConfig(this.config.channels?.[channelId]);
    if (!this.shouldRunChannelPlugin(plugin, channelConfig)) {
      log.debug({ channel: channelId }, 'Channel disabled in config, skipping start');
      return;
    }
    if (!this.initializedPluginIds.has(channelId)) {
      log.warn({ channel: channelId }, 'Channel was never initialized; call initializeChannels first');
      return;
    }
    await this.startPlugin(plugin, {});
  }

  getRuntimeSnapshot(): {
    initialized: boolean;
    running: boolean;
    pluginIds: string[];
    initializedPluginIds: string[];
    manuallyStopped: string[];
    restartAttempts: Record<string, number>;
    channelHealth: Record<string, ChannelHealthState>;
  } {
    return {
      initialized: this.initialized,
      running: this.running,
      pluginIds: [...this.plugins.keys()],
      initializedPluginIds: [...this.initializedPluginIds],
      manuallyStopped: [...this.manuallyStopped],
      restartAttempts: Object.fromEntries(this.restartAttempts),
      channelHealth: this.healthMonitor.toJSON(),
    };
  }

  getHealthMonitor(): ChannelHealthMonitor {
    return this.healthMonitor;
  }
  
  /**
   * Channel IDs whose runtime reports connected (e.g. Telegram polling active).
   */
  getRunningChannels(): string[] {
    const result: string[] = [];
    for (const id of this.initializedPluginIds) {
      const plugin = this.plugins.get(id);
      if (!plugin?.channelIsRunning) {
        continue;
      }
      if (plugin.channelIsRunning(this.config)) {
        result.push(id);
      }
    }
    return result;
  }
  
  getAllChannels(): ChannelPlugin[] {
    return this.getAllPlugins();
  }
}

export function createChannelManager(config: Config, bus: MessageBus): ChannelManager {
  return new ChannelManager(config, bus);
}
