/**
 * ChannelPluginRegistry — owns the in-memory plugin map and provides typed
 * lookup helpers.
 *
 * Previously this lived as one of the eight responsibilities on the 707-line
 * `ChannelManager`. Splitting it out lets the lifecycle / heartbeat / outbound
 * coordinators depend only on the lookup surface they need (registry +
 * `getPlugin`), not on the full manager.
 */

import type { Config } from '../config/schema.js';

import type { ChannelPlugin } from './plugin-types.js';
import { syncChannelPluginsFromManager } from './plugins/registry.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ChannelPluginRegistry');

export class ChannelPluginRegistry {
  private readonly plugins = new Map<string, ChannelPlugin>();

  register(plugin: ChannelPlugin): void {
    const current = this.plugins.get(plugin.id);
    if (current === plugin) {
      log.debug({ channel: plugin.id }, 'Channel plugin already registered');
      return;
    }
    if (current) {
      log.warn({ channel: plugin.id }, 'Channel plugin already registered, overwriting');
    }
    this.plugins.set(plugin.id, plugin);
    syncChannelPluginsFromManager(this.all());
    log.debug({ channel: plugin.id }, 'Registered channel plugin');
  }

  get(id: string): ChannelPlugin | undefined {
    return this.plugins.get(id);
  }

  has(id: string): boolean {
    return this.plugins.has(id);
  }

  all(): ChannelPlugin[] {
    return Array.from(this.plugins.values());
  }

  ids(): string[] {
    return [...this.plugins.keys()];
  }

  entries(): IterableIterator<[string, ChannelPlugin]> {
    return this.plugins.entries();
  }

  /** Plugin ids whose runtime currently reports connected (e.g. Telegram polling active). */
  runningChannelIds(cfg: Config, isInitialized: (id: string) => boolean): string[] {
    const out: string[] = [];
    for (const [id, plugin] of this.plugins) {
      if (!isInitialized(id)) continue;
      if (!plugin.channelIsRunning) continue;
      if (plugin.channelIsRunning(cfg)) out.push(id);
    }
    return out;
  }
}
