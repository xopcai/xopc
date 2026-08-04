/**
 * GatewayConfigCoordinator — owns config persistence, hot-reload, and the
 * per-section reload handlers.
 *
 * Was 350 lines of `GatewayService` covering nine concerns:
 *   - manual `reloadConfig()` (CLI/UI trigger)
 *   - `saveConfig()` / `updateConfig()` (PATCH /api/config)
 *   - `setBundledExtensionActivationTarget` (extension store install)
 *   - `afterWeixinCredentialsPersisted` / `afterFeishuCredentialsPersisted`
 *     (QR-login follow-ups that bypass the watcher)
 *   - `ConfigHotReloader` (fs.watch → debounced per-section dispatch)
 *   - Section reload handlers (models / agents / channels /
 *     heartbeat / tools / mcp / extensions)
 *   - `scheduleChannelPluginsAfterPersist` (coalesces rapid saves so
 *     Telegram/Weixin do not stop/start repeatedly)
 *
 * Pulled out so the gateway composition root stays focused on lifecycle, and
 * each handler is reachable from one place when adding a new config section.
 *
 * **Config state ownership.** `GatewayService.config` is still the single
 * source of truth — this coordinator reads it via `getConfig()` and writes it
 * back via `setConfig()` after every reload / persist. We pass through rather
 * than holding our own copy so other coordinators (sessions, marketplace,
 * agent runner) see the latest config the moment a reload commits.
 */
import type { Config } from '../../config/schema.js';
import type { Config as SurfaceConfig } from '../../config/config-surface.js';
import type { AgentService } from '../../agent/service.js';
import type { ChannelManager } from '../../channels/manager.js';
import type { HeartbeatService } from '../heartbeat/index.js';
import type { ExtensionLoader } from '../../extensions/loader.js';
import type { MessageBus } from '../../infra/bus/index.js';
import { ConfigHotReloader } from '../../config/reload.js';
import { loadConfig, saveConfig as writeConfigToDisk } from '../../config/index.js';
import { sanitizeTunnelConfig } from '../../tunnel/tunnel-config.js';
import { getModelRegistry } from '../../providers/index.js';
import { disposeAllSessionMcpRuntimes } from '../../agent/mcp/bundle-mcp-tools.js';
import { reloadImageGenerationProviders } from '../../agent/image/generation/provider-registry.js';
import { computeBundledExtensionExtensionsPatch } from '../../extensions/bundled-extension-activation.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('GatewayConfigCoordinator');

export interface GatewayConfigCoordinatorOptions {
  configPath: string;
  bus: MessageBus;
  /** Hot reload (fs.watch) — disabled in tests / certain CLI modes. */
  enableHotReload: boolean;
  getConfig: () => Config;
  /** Writes the new config back into `GatewayService.config`. */
  setConfig: (next: Config) => void;
  getAgentService: () => AgentService;
  getChannelManager: () => ChannelManager;
  getHeartbeatService: () => HeartbeatService | null;
  getExtensionLoader: () => ExtensionLoader | null;
  /** Re-evaluate browser-extension server attachment after agent defaults change. */
  reconcileBrowserExtensionServer: () => Promise<void>;
  /** Sync built-in dreaming automations after memory.dreaming changes. */
  reconcileDreamingAutomations: () => Promise<void>;
  /** Latest channel status snapshot for the `channels.status` SSE event. */
  getChannelsStatus: () => unknown;
  /** SSE emit (used for `config.reload` + `channels.status`). */
  emit: (type: string, payload: unknown) => void;
}

export class GatewayConfigCoordinator {
  private readonly opts: GatewayConfigCoordinatorOptions;
  private configReloader: ConfigHotReloader | null = null;
  private channelReloadFlushPromise: Promise<void> | null = null;
  private channelReloadPending = false;

  constructor(opts: GatewayConfigCoordinatorOptions) {
    this.opts = opts;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Start the fs.watch-based reloader (idempotent — only starts once). */
  startHotReloader(): void {
    if (this.configReloader) return;
    this.configReloader = new ConfigHotReloader(
      this.opts.configPath,
      this.opts.getConfig(),
      {
        onModelsReload: (newConfig) => this.handleModelsReload(newConfig),
        onAgentDefaultsReload: (newConfig) => this.handleAgentDefaultsReload(newConfig),
        onChannelsReload: (newConfig) => this.handleChannelsReload(newConfig),
        onCronReload: (newConfig) => this.handleAutomationReload(newConfig),
        onHeartbeatReload: (newConfig) => this.handleHeartbeatReload(newConfig),
        onToolsReload: (newConfig) => this.handleToolsReload(newConfig),
        onMcpReload: (newConfig) => this.handleMcpReload(newConfig),
        onExtensionsReload: async (newConfig, changedPaths) => {
          await this.handleExtensionsReload(newConfig, changedPaths);
        },
        onFullRestart: (newConfig) => {
          log.warn(
            { requiresProcessRestart: true, hint: 'Restart the gateway process (hot reload cannot apply this change).' },
            'Config reload: full gateway restart required — see prior "restartPaths" info log',
          );
          this.opts.setConfig(newConfig);
          this.opts.emit('config.reload', { section: 'full', requiresRestart: true });
        },
      },
      {
        debounceMs: 300,
        enabled: this.opts.enableHotReload,
      }
    );
    this.configReloader.start();
  }

  async stopHotReloader(): Promise<void> {
    if (this.configReloader) {
      await this.configReloader.stop();
      this.configReloader = null;
    }
  }

  // ── Manual reload (UI trigger) ─────────────────────────────────────────

  async reloadConfig(): Promise<{ reloaded: boolean; error?: string }> {
    if (!this.configReloader) {
      return { reloaded: false, error: 'Config reloader not initialized' };
    }
    const result = await this.configReloader.triggerReload();
    return { reloaded: result.success, error: result.error };
  }

  // ── Persist (PATCH /api/config, marketplace install, etc.) ─────────────

  async saveConfig(config: Config): Promise<{ saved: boolean; error?: string }> {
    try {
      await this.writeConfigAndReloadFromDisk(config);
      this.scheduleChannelPluginsAfterPersist();
      return { saved: true };
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.error({ err, errorMessage: em, phase: 'infra.config' }, `Failed to save config: ${em}`);
      return { saved: false, error: em };
    }
  }

  /** Merge partial updates into `currentConfig` and persist. */
  async updateConfig(updates: Partial<Config>): Promise<{ updated: boolean; error?: string }> {
    try {
      log.debug('Updating configuration...');
      const merged = { ...this.opts.getConfig(), ...updates };
      this.opts.setConfig(merged);
      await this.writeConfigAndReloadFromDisk(merged);
      this.scheduleChannelPluginsAfterPersist();
      log.debug('Configuration updated successfully');
      return { updated: true };
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.error({ err, errorMessage: em, phase: 'infra.config' }, `Failed to update config: ${em}`);
      return { updated: false, error: em };
    }
  }

  /**
   * App store (phase 1): persist `extensions.enabled` / `extensions.disabled`
   * for a bundled extension. Marketplace-only extensions hot-load on enable;
   * disable still needs a gateway restart to unload.
   */
  async setBundledExtensionActivationTarget(
    extensionId: string,
    wanted: boolean,
  ): Promise<{ ok: boolean; error?: string; requiresGatewayRestart: boolean }> {
    const loader = this.opts.getExtensionLoader();
    if (!loader) {
      return { ok: false, error: 'Extension loader unavailable', requiresGatewayRestart: false };
    }
    const id = extensionId.trim();
    if (!id) {
      return { ok: false, error: 'Invalid extension id', requiresGatewayRestart: false };
    }
    const patch = computeBundledExtensionExtensionsPatch(loader, this.opts.getConfig(), id, wanted);
    if (patch.ok === false) {
      return { ok: false, error: patch.error, requiresGatewayRestart: false };
    }
    const newConfig = { ...this.opts.getConfig(), extensions: patch.extensions } as Config;
    const saved = await this.saveConfig(newConfig);
    if (!saved.saved) {
      return { ok: false, error: saved.error ?? 'Failed to save config', requiresGatewayRestart: false };
    }
    loader.setConfig(this.opts.getConfig() as unknown as SurfaceConfig);

    let requiresGatewayRestart = true;
    if (wanted) {
      try {
        loader.invalidateManifestCache();
        await loader.loadByActivationPlan();
        requiresGatewayRestart = false;
      } catch (err) {
        const em = err instanceof Error ? err.message : String(err);
        log.warn(
          { err, extensionId: id, errorMessage: em },
          `Extension hot-load after bundled activation failed: ${em}`,
        );
        requiresGatewayRestart = true;
      }
    }

    this.opts.emit('config.reload', { section: 'extensions', source: 'bundled-activation' });
    return { ok: true, requiresGatewayRestart };
  }

  // ── QR-login follow-ups (bypass fs watcher) ────────────────────────────

  async afterWeixinCredentialsPersisted(): Promise<void> {
    const next = loadConfig(this.opts.configPath);
    this.opts.setConfig(next);
    this.opts.getAgentService().applyAgentDefaultsFromConfig(next);
    this.configReloader?.syncCurrentConfig(next);
    await this.handleChannelsReload(next);
    const { weixinPlugin } = await import('../../channels/weixin/index.js');
    await weixinPlugin.reloadMonitorsWithConfig(this.opts.getConfig(), this.opts.bus);
    log.info('Weixin monitors restarted after credential login');
  }

  async afterFeishuCredentialsPersisted(): Promise<void> {
    const next = loadConfig(this.opts.configPath);
    this.opts.setConfig(next);
    this.opts.getAgentService().applyAgentDefaultsFromConfig(next);
    this.configReloader?.syncCurrentConfig(next);
    await this.handleChannelsReload(next);
    log.info('Feishu config applied after QR setup');
  }

  // ── Section reload handlers (also used by manual triggers) ─────────────

  /**
   * Apply `latest.channels` to every registered channel plugin (Telegram,
   * Weixin, extensions). Single runtime path for: file watcher hot reload, API
   * saves, and Weixin QR follow-up.
   */
  async handleChannelsReload(newConfig: Config): Promise<void> {
    log.debug('Reloading channels config...');
    this.opts.setConfig(newConfig);
    await this.opts.getChannelManager().updateConfig(newConfig);
    this.opts.emit('config.reload', { section: 'channels' });
    this.opts.emit('channels.status', { channels: this.opts.getChannelsStatus() });
    log.debug('Channels config reloaded');
  }

  /**
   * Apply `gateway.heartbeat` from current config after PATCH /api/config (and
   * when hot reload is off). File watcher uses `handleHeartbeatReload` with
   * the same effect when paths match.
   */
  reloadHeartbeatFromCurrentConfig(): void {
    this.handleHeartbeatReload(this.opts.getConfig());
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private handleModelsReload(newConfig: Config): void {
    log.debug('Reloading models config...');
    this.opts.setConfig(newConfig);
    getModelRegistry().refresh();
    reloadImageGenerationProviders();
    this.opts.emit('config.reload', { section: 'models' });
    log.debug('Models config reloaded');
  }

  private handleAgentDefaultsReload(newConfig: Config): void {
    log.debug('Reloading agent defaults...');
    this.opts.setConfig(newConfig);
    this.opts.getAgentService().applyAgentDefaultsFromConfig(newConfig);
    void this.opts.reconcileBrowserExtensionServer();
    void this.opts.reconcileDreamingAutomations().catch((err) => {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, errorMessage: em }, `Dreaming automation refresh failed: ${em}`);
    });
    this.opts.emit('config.reload', { section: 'agents' });
    log.debug('Agent defaults reloaded');
  }

  /**
   * Coalesces rapid saves so Telegram/Weixin do not stop/start repeatedly.
   * The persist path schedules the channel apply; the same coalescer absorbs
   * follow-up saves until the first flush settles.
   */
  private scheduleChannelPluginsAfterPersist(): void {
    this.channelReloadPending = true;
    if (this.channelReloadFlushPromise) return;
    this.channelReloadFlushPromise = (async () => {
      try {
        while (this.channelReloadPending) {
          this.channelReloadPending = false;
          await this.handleChannelsReload(this.opts.getConfig());
        }
      } catch (err) {
        const em = err instanceof Error ? err.message : String(err);
        log.error({ err, errorMessage: em }, `Channel reload after persist failed: ${em}`);
      } finally {
        this.channelReloadFlushPromise = null;
        if (this.channelReloadPending) {
          this.scheduleChannelPluginsAfterPersist();
        }
      }
    })();
  }

  private handleAutomationReload(newConfig: Config): void {
    log.debug('Reloading automation-related config...');
    this.opts.setConfig(newConfig);
    this.opts.emit('config.reload', { section: 'automations' });
    log.debug('Automation-related config reloaded');
  }

  private handleHeartbeatReload(newConfig: Config): void {
    log.debug('Reloading heartbeat config...');
    this.opts.setConfig(newConfig);
    this.opts.getHeartbeatService()?.updateConfig(newConfig);
    this.opts.emit('config.reload', { section: 'heartbeat' });
    log.debug('Heartbeat config reloaded');
  }

  private handleToolsReload(newConfig: Config): void {
    log.debug('Reloading tools config...');
    this.opts.setConfig(newConfig);
    this.opts.emit('config.reload', { section: 'tools' });
    log.debug('Tools config reloaded');
  }

  private handleMcpReload(newConfig: Config): void {
    log.debug('Reloading MCP config...');
    this.opts.setConfig(newConfig);
    void disposeAllSessionMcpRuntimes().catch((err) => {
      log.warn({ err }, 'MCP runtime dispose on config reload failed');
    });
    this.opts.emit('config.reload', { section: 'mcp' });
    log.debug('MCP config reloaded');
  }

  /** Dispatch config hot reload to extensions that registered `registerReload`. */
  private async handleExtensionsReload(
    newConfig: Config,
    changedPaths: string[],
  ): Promise<void> {
    this.opts.setConfig(newConfig);
    const loader = this.opts.getExtensionLoader();
    loader?.setConfig(newConfig as unknown as SurfaceConfig);

    if (!loader) {
      this.opts.emit('config.reload', {
        section: 'extensions',
        source: 'extension-reload',
        changedPaths,
      });
      return;
    }

    const registry = loader.getRegistry();
    const matchingRegs = registry.getMatchingReloadRegistrations(changedPaths);

    if (matchingRegs.length === 0) {
      log.debug({ changedPaths }, 'No extension reload handlers matched');
      this.opts.emit('config.reload', {
        section: 'extensions',
        source: 'extension-reload',
        changedPaths,
      });
      return;
    }

    for (const reg of matchingRegs) {
      const relevantPaths = changedPaths.filter(
        (p) =>
          reg.configPrefixes.length === 0 ||
          reg.configPrefixes.some(
            (prefix) => p === prefix || p.startsWith(`${prefix}.`),
          ),
      );

      log.info(
        { extensionId: reg.extensionId, relevantPaths },
        'Calling extension reload handler',
      );

      try {
        const result = await reg.handler(newConfig, relevantPaths);
        if (result.success) {
          log.info({ extensionId: reg.extensionId }, 'Extension reload succeeded');
        } else {
          log.warn(
            { extensionId: reg.extensionId, error: result.error },
            `Extension reload reported failure: ${result.error ?? 'unknown'}`,
          );
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log.error(
          { err, extensionId: reg.extensionId, errorMessage },
          `Extension reload handler threw: ${errorMessage}`,
        );
      }
    }

    this.opts.emit('config.reload', {
      section: 'extensions',
      source: 'extension-reload',
      changedPaths,
    });
  }

  /**
   * Persist and replace `currentConfig` with the validated file contents so
   * runtime matches disk (PATCH merge objects can drift from Zod-normalized
   * output).
   */
  private async writeConfigAndReloadFromDisk(configToWrite: Config): Promise<void> {
    await writeConfigToDisk(configToWrite, this.opts.configPath);
    const reloaded = loadConfig(this.opts.configPath);
    this.opts.setConfig(reloaded);
    if (sanitizeTunnelConfig(reloaded)) {
      await writeConfigToDisk(reloaded, this.opts.configPath);
    }
    this.opts.getAgentService().applyAgentDefaultsFromConfig(reloaded);
    await this.opts.reconcileBrowserExtensionServer();
    // Keep built-in dreaming automations aligned with memory.dreaming.
    await this.opts.reconcileDreamingAutomations().catch((err) => {
      const em = err instanceof Error ? err.message : String(err);
      log.warn({ err, errorMessage: em }, `Dreaming automation refresh after save failed: ${em}`);
    });
    // Align watcher baseline before channel hooks run so fs `change` does not
    // re-apply the same diff concurrently.
    this.configReloader?.syncCurrentConfig(reloaded);
  }
}
