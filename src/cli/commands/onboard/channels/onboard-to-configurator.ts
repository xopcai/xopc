import type { ChannelPlugin } from '../../../../channels/plugin-types.js';
import type { ChannelConfigurator } from './types.js';

/**
 * Maps {@link ChannelPlugin.onboard} to the onboard {@link ChannelConfigurator} contract.
 */
export function channelOnboardToConfigurator(plugin: ChannelPlugin): ChannelConfigurator {
  const { onboard } = plugin;
  if (!onboard) throw new Error(`Plugin ${plugin.id} has no onboard adapter`);

  return {
    id: plugin.id,
    name: plugin.meta.label,
    description: plugin.meta.blurb,
    isConfigured: (config) => onboard.isConfigured(config),
    configure: (config) => onboard.configure(config),
  };
}
