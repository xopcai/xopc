/**
 * ChannelLifecycleSupervisor — owns the start/stop/restart state machine for
 * every channel plugin.
 *
 * Concerns:
 *   - `initialize()` — call each plugin's `init(...)` once and remember success
 *   - Two-phase `start()` + `startDeferredConnects()` for channels whose
 *     `meta.deferConnectUntilAfterListen` is true (HTTP listener has to be up
 *     before they dial out)
 *   - Per-channel manual stop / start (UI-driven; suppresses auto-restart)
 *   - Exponential restart backoff via {@link CHANNEL_RESTART_POLICY}
 *   - Soft restart (called from heartbeat) — stop + startPlugin, manual-stop guarded
 *
 * Heartbeat probes themselves live in {@link ChannelHeartbeatScheduler}; this
 * supervisor schedules them via `onPluginStarted` / `onPluginStopped` callbacks
 * passed in by the caller.
 *
 * Extracted from `ChannelManager` so the manager can be a thin composition root.
 */

import type { Config } from '../config/schema.js';
import type { MessageBus } from '../infra/bus/index.js';

import type {
  ChannelPlugin,
  ChannelPluginInitOptions,
  ChannelPluginSessionModelHooks,
  ChannelPluginStartOptions,
} from './plugin-types.js';
import type { ChannelPluginRegistry } from './plugin-registry.js';
import { CHANNEL_RESTART_POLICY, computeBackoff } from './restart-policy.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ChannelLifecycleSupervisor');

function asChannelConfig(raw: unknown): Record<string, unknown> | undefined {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return undefined;
}

export interface ChannelLifecycleSupervisorOptions {
  bus: MessageBus;
  registry: ChannelPluginRegistry;
  /** Effective config snapshot (per-channel `channels.<id>.*`). */
  getConfig: () => Config;
  /** Hooks for sub-classes / external observers: heartbeat scheduling, etc. */
  onPluginStarted?: (plugin: ChannelPlugin) => void;
  onPluginStopped?: (pluginId: string) => void;
  /** Optional session-model hooks forwarded into `plugin.init()`. */
  getSessionModelHooks?: () => ChannelPluginSessionModelHooks | undefined;
}

export class ChannelLifecycleSupervisor {
  private readonly opts: ChannelLifecycleSupervisorOptions;
  /** Plugin ids whose `init()` completed (used by start/stop loops). */
  private readonly initializedPluginIds = new Set<string>();
  private readonly restartAttempts = new Map<string, number>();
  /** When set, failed-start auto-restart is suppressed for that channel id. */
  private readonly manuallyStopped = new Set<string>();
  /** Plugins that skipped `start()` until `startDeferredConnects()`. */
  private readonly deferredConnectPending = new Set<string>();
  private initialized = false;
  private running = false;

  constructor(opts: ChannelLifecycleSupervisorOptions) {
    this.opts = opts;
  }

  isInitialized(pluginId: string): boolean {
    return this.initializedPluginIds.has(pluginId);
  }

  snapshot(): {
    initialized: boolean;
    running: boolean;
    initializedPluginIds: string[];
    manuallyStopped: string[];
    restartAttempts: Record<string, number>;
  } {
    return {
      initialized: this.initialized,
      running: this.running,
      initializedPluginIds: [...this.initializedPluginIds],
      manuallyStopped: [...this.manuallyStopped],
      restartAttempts: Object.fromEntries(this.restartAttempts),
    };
  }

  /** Channel ids that would run and declare `meta.deferConnectUntilAfterListen` (for logging / metrics). */
  listDeferConnectChannelIds(cfg: Config): string[] {
    const out: string[] = [];
    for (const [id, plugin] of this.opts.registry.entries()) {
      const channelConfig = asChannelConfig(cfg.channels?.[id]);
      if (!this.shouldRunChannelPlugin(plugin, channelConfig)) continue;
      if (plugin.meta.deferConnectUntilAfterListen === true) {
        out.push(id);
      }
    }
    return out;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      log.warn(
        { pluginCount: this.opts.registry.ids().length },
        'initialize() called again; channels already initialized — skipping',
      );
      return;
    }

    const cfg = this.opts.getConfig();
    const initPromises: Promise<void>[] = [];

    for (const [id, plugin] of this.opts.registry.entries()) {
      const channelConfig = asChannelConfig(cfg.channels?.[id]);
      // Always init so `onConfigUpdated` runs on hot reload (e.g. Weixin turned off after QR-login
      // started monitors while the plugin was previously skipped here and had no bus/`initialized` id).
      initPromises.push(this.initializePlugin(plugin, channelConfig ?? {}));
    }

    await Promise.allSettled(initPromises);
    this.initialized = true;
    log.info('All channel plugins initialized');
  }

  async initializeChannel(channelId: string): Promise<boolean> {
    const plugin = this.opts.registry.get(channelId);
    if (!plugin) {
      log.warn({ channel: channelId }, 'Unknown channel');
      return false;
    }
    if (this.initializedPluginIds.has(channelId)) {
      return true;
    }
    const cfg = this.opts.getConfig();
    await this.initializePlugin(plugin, asChannelConfig(cfg.channels?.[channelId]) ?? {});
    return this.initializedPluginIds.has(channelId);
  }

  /** Phase 1: start every enabled channel except those in `deferConnectPluginIds`. */
  async start(options?: { deferConnectPluginIds?: ReadonlySet<string> }): Promise<void> {
    if (!this.initialized) {
      throw new Error('Channels not initialized');
    }
    if (this.running) {
      log.warn(
        { pluginCount: this.opts.registry.ids().length },
        'start() called while channels already running — skipping',
      );
      return;
    }

    const deferIds = options?.deferConnectPluginIds ?? new Set<string>();
    this.deferredConnectPending.clear();

    const cfg = this.opts.getConfig();
    const startPromises: Promise<void>[] = [];

    for (const [id, plugin] of this.opts.registry.entries()) {
      const channelConfig = asChannelConfig(cfg.channels?.[id]);
      if (!this.shouldRunChannelPlugin(plugin, channelConfig)) continue;

      if (deferIds.has(id)) {
        this.deferredConnectPending.add(id);
        log.info({ channel: id }, 'Channel connect deferred until HTTP listen');
        continue;
      }

      startPromises.push(
        this.startPlugin(plugin, {}).catch((err) => {
          log.error({ channel: id, err }, 'Failed to start channel plugin');
        }),
      );
    }

    await Promise.allSettled(startPromises);
    this.running = true;
    log.info(
      { deferred: [...this.deferredConnectPending] },
      this.deferredConnectPending.size > 0
        ? 'Channel plugins started (deferred connects pending)'
        : 'All channel plugins started',
    );
  }

  /** Phase 2: `start()` for channels deferred at Phase 1. No-op if none pending. */
  async startDeferredConnects(): Promise<void> {
    if (this.deferredConnectPending.size === 0) return;
    if (!this.running) {
      log.warn('startDeferredConnects called before channel phase-1 start; skipping');
      return;
    }
    const ids = [...this.deferredConnectPending];
    this.deferredConnectPending.clear();
    const cfg = this.opts.getConfig();
    const startPromises: Promise<void>[] = [];
    for (const id of ids) {
      const plugin = this.opts.registry.get(id);
      if (!plugin) continue;
      const channelConfig = asChannelConfig(cfg.channels?.[id]);
      if (!this.shouldRunChannelPlugin(plugin, channelConfig)) continue;
      startPromises.push(
        this.startPlugin(plugin, {}).catch((err) => {
          log.error({ channel: id, err }, 'Failed to start deferred channel plugin');
        }),
      );
    }
    await Promise.allSettled(startPromises);
    log.info({ channels: ids }, 'Deferred channel connects completed');
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.deferredConnectPending.clear();

    const stopPromises: Promise<void>[] = [];
    for (const id of this.initializedPluginIds) {
      const plugin = this.opts.registry.get(id);
      if (!plugin) continue;
      stopPromises.push(
        this.stopPlugin(plugin).catch((err) => {
          log.error({ channel: id, err }, 'Failed to stop channel plugin');
        }),
      );
    }

    await Promise.allSettled(stopPromises);
    this.running = false;
    log.info('All channel plugins stopped');
  }

  /** Stop one channel and suppress automatic restart until `startChannel` is called. */
  async stopChannel(channelId: string): Promise<void> {
    this.manuallyStopped.add(channelId);
    const plugin = this.opts.registry.get(channelId);
    if (!plugin || !this.initializedPluginIds.has(channelId)) {
      return;
    }
    await this.stopPlugin(plugin).catch((err) => {
      log.error({ channel: channelId, err }, 'Failed to stop channel plugin');
    });
  }

  /** Clear manual-stop and start one channel (requires prior `initialize()`). */
  async startChannel(channelId: string): Promise<void> {
    this.manuallyStopped.delete(channelId);
    const plugin = this.opts.registry.get(channelId);
    if (!plugin) {
      log.warn({ channel: channelId }, 'Unknown channel');
      return;
    }
    if (!this.initialized) {
      log.warn({ channel: channelId }, 'Channels not initialized');
      return;
    }
    const cfg = this.opts.getConfig();
    const channelConfig = asChannelConfig(cfg.channels?.[channelId]);
    if (!this.shouldRunChannelPlugin(plugin, channelConfig)) {
      log.debug({ channel: channelId }, 'Channel disabled in config, skipping start');
      return;
    }
    if (!this.initializedPluginIds.has(channelId)) {
      log.warn({ channel: channelId }, 'Channel was never initialized; call initialize() first');
      return;
    }
    await this.startPlugin(plugin, {});
  }

  /** Called by heartbeat: stop + start without clearing manualStop. No-op if user stopped it. */
  async softRestart(channelId: string): Promise<void> {
    if (this.manuallyStopped.has(channelId)) return;
    const plugin = this.opts.registry.get(channelId);
    if (!plugin || !this.initializedPluginIds.has(channelId)) return;
    try {
      await this.stopPlugin(plugin);
      await this.startPlugin(plugin, {});
    } catch (err) {
      log.error({ channel: channelId, err }, 'Channel soft restart after heartbeat failed');
    }
  }

  /** Forward a config snapshot to every initialised plugin's `onConfigUpdated` hook. */
  async forwardConfigUpdate(cfg: Config): Promise<void> {
    for (const id of this.initializedPluginIds) {
      const plugin = this.opts.registry.get(id);
      if (plugin?.onConfigUpdated) {
        await Promise.resolve(plugin.onConfigUpdated(cfg));
      }
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────

  /**
   * Builtin channels require `channels.<id>.enabled`. Extension-managed channels
   * run unless explicitly disabled.
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
    channelConfig: Record<string, unknown>,
  ): Promise<void> {
    try {
      const options: ChannelPluginInitOptions = {
        bus: this.opts.bus,
        config: this.opts.getConfig(),
        channelConfig,
        sessionModel: this.opts.getSessionModelHooks?.(),
      };
      await plugin.init(options);
      this.initializedPluginIds.add(plugin.id);
      log.debug({ channel: plugin.id }, 'Channel plugin initialized');
    } catch (err) {
      log.error({ channel: plugin.id, err }, 'Failed to initialize channel plugin');
    }
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
      this.opts.onPluginStarted?.(plugin);
      log.debug({ channel: plugin.id }, 'Channel plugin started');
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

  private async stopPlugin(plugin: ChannelPlugin): Promise<void> {
    this.opts.onPluginStopped?.(plugin.id);
    await plugin.stop();
    log.info({ channel: plugin.id }, 'Channel plugin stopped');
  }
}
