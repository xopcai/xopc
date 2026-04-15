/**
 * Cached view of registered ChannelPlugin instances (mirrors ChannelManager).
 */

import type { ChannelPlugin } from '../plugin-types.js';

let cacheVersion = 0;
let sorted: ChannelPlugin[] = [];
const byId = new Map<string, ChannelPlugin>();
let lastPluginIdSignature = '';

function sortPlugins(plugins: ChannelPlugin[]): ChannelPlugin[] {
  return plugins.toSorted((a, b) => {
    const orderA = a.meta.order ?? 999;
    const orderB = b.meta.order ?? 999;
    if (orderA !== orderB) return orderA - orderB;
    return a.id.localeCompare(b.id);
  });
}

export function syncChannelPluginsFromManager(plugins: ChannelPlugin[]): void {
  const dedup = new Map<string, ChannelPlugin>();
  for (const p of plugins) {
    dedup.set(p.id, p);
  }
  const nextSorted = sortPlugins(Array.from(dedup.values()));
  const signature = nextSorted.map((p) => p.id).join('\0');
  if (signature !== lastPluginIdSignature) {
    lastPluginIdSignature = signature;
    cacheVersion++;
  }
  sorted = nextSorted;
  byId.clear();
  for (const p of sorted) {
    byId.set(p.id, p);
  }
}

export function getChannelRegistryVersion(): number {
  return cacheVersion;
}

export function listChannelPlugins(): readonly ChannelPlugin[] {
  return sorted;
}

export function getChannelPlugin(id: string): ChannelPlugin | undefined {
  return byId.get(id);
}
