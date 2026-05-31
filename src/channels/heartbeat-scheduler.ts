/**
 * ChannelHeartbeatScheduler — runs per-account heartbeat probes for plugins
 * that expose a `heartbeat.check(...)` hook, records the result in the shared
 * {@link ChannelHealthMonitor}, and asks the lifecycle supervisor for a soft
 * restart when a check fails (rate-limited to once per minute per channel).
 *
 * Previously this lived as `_scheduleHeartbeat` + `_clearHeartbeatTimers` +
 * `_softRestartChannel` + two private Maps on `ChannelManager`. Extracting it
 * makes the heartbeat policy testable in isolation and lets the lifecycle
 * supervisor focus on plugin start/stop without worrying about timer wiring.
 */

import type { Config } from '../config/schema.js';

import type { ChannelPlugin } from './plugin-types.js';
import type { ChannelHealthMonitor } from './health-monitor.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ChannelHeartbeatScheduler');

/** Minimum gap between successive soft-restart attempts for the same channel. */
const HEARTBEAT_RESTART_THROTTLE_MS = 60_000;

export interface ChannelHeartbeatSchedulerOptions {
  /** Effective config snapshot (per-account listing comes from `plugin.config.listAccountIds(cfg)`). */
  getConfig: () => Config;
  /** Shared health monitor that channel APIs surface to the UI. */
  healthMonitor: ChannelHealthMonitor;
  /**
   * Triggered when a check fails AND we are past the restart-throttle window.
   * The supervisor performs `stop()` + `startPlugin()`; the scheduler does not
   * touch plugin lifecycle directly.
   */
  requestSoftRestart: (channelId: string) => void;
}

export class ChannelHeartbeatScheduler {
  private readonly opts: ChannelHeartbeatSchedulerOptions;
  /** Key shape: `${pluginId}:${accountId}`. */
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly lastRestartAt = new Map<string, number>();

  constructor(opts: ChannelHeartbeatSchedulerOptions) {
    this.opts = opts;
  }

  /** Register heartbeat checks for every account exposed by the plugin. */
  schedule(plugin: ChannelPlugin): void {
    const hb = plugin.heartbeat;
    if (!hb) return;

    this.clear(plugin.id);

    let accountIds: string[];
    try {
      accountIds = plugin.config.listAccountIds(this.opts.getConfig());
    } catch (err) {
      log.warn({ channel: plugin.id, err }, 'Heartbeat: failed to list accounts');
      return;
    }

    for (const accountId of accountIds) {
      const key = `${plugin.id}:${accountId}`;
      const timer = setInterval(
        () => void this.runProbe(plugin, accountId),
        hb.intervalMs,
      );
      this.timers.set(key, timer);
    }
  }

  /** Drop every probe scheduled for `pluginId` (called on stop / soft-restart). */
  clear(pluginId: string): void {
    const prefix = `${pluginId}:`;
    for (const key of [...this.timers.keys()]) {
      if (!key.startsWith(prefix)) continue;
      clearInterval(this.timers.get(key)!);
      this.timers.delete(key);
    }
  }

  /** Test helper / process shutdown. */
  clearAll(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
    this.lastRestartAt.clear();
  }

  private async runProbe(plugin: ChannelPlugin, accountId: string): Promise<void> {
    const hb = plugin.heartbeat;
    if (!hb) return;
    const cfg = this.opts.getConfig();
    try {
      const r = await hb.check({ cfg, accountId });
      this.opts.healthMonitor.set(plugin.id, accountId, {
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
        const last = this.lastRestartAt.get(plugin.id) ?? 0;
        if (now - last < HEARTBEAT_RESTART_THROTTLE_MS) {
          return;
        }
        this.lastRestartAt.set(plugin.id, now);
        this.opts.requestSoftRestart(plugin.id);
      }
    } catch (err) {
      this.opts.healthMonitor.set(plugin.id, accountId, {
        healthy: false,
        lastCheckAt: Date.now(),
        detail: err instanceof Error ? err.message : String(err),
      });
      log.error({ channel: plugin.id, accountId, err }, 'Channel heartbeat check failed');
    }
  }
}
