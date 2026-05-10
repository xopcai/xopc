import type { ChannelManager } from '../channels/manager.js';
import type { Config } from '../config/schema.js';

export type ChannelConnectDeferSource = 'off' | 'explicit' | 'meta';

export type ResolvedChannelConnectDefer = {
  deferPluginIds: Set<string>;
  mode: 'auto' | 'off' | 'explicit';
  /** Which rule produced `deferPluginIds` before skip filtering (`meta` includes skip application). */
  source: ChannelConnectDeferSource;
};

/**
 * Resolve which channel plugin ids should skip `start()` in phase1 when HTTP lifecycle defer is on.
 */
export function resolveChannelConnectDeferSet(params: {
  config: Config;
  channelManager: ChannelManager;
  deferChannelConnectUntilAfterHttp: boolean;
}): ResolvedChannelConnectDefer {
  if (!params.deferChannelConnectUntilAfterHttp) {
    return { deferPluginIds: new Set(), mode: 'auto', source: 'off' };
  }

  const gw = params.config.gateway;
  const mode = gw?.channelConnectDeferMode ?? 'auto';

  if (mode === 'off') {
    return { deferPluginIds: new Set(), mode: 'off', source: 'off' };
  }

  if (mode === 'explicit') {
    const ids = [...new Set((gw?.channelConnectDeferIds ?? []).map((s) => s.trim()).filter(Boolean))];
    const skip = new Set((gw?.channelConnectDeferSkipIds ?? []).map((s) => s.trim()).filter(Boolean));
    const deferPluginIds = new Set(ids.filter((id) => !skip.has(id)));
    return { deferPluginIds, mode: 'explicit', source: 'explicit' };
  }

  const metaIds = params.channelManager.listDeferConnectChannelIds(params.config);
  const skip = new Set((gw?.channelConnectDeferSkipIds ?? []).map((s) => s.trim()).filter(Boolean));
  const deferPluginIds = new Set(metaIds.filter((id) => !skip.has(id)));
  return { deferPluginIds, mode: 'auto', source: 'meta' };
}
