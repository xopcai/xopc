/**
 * Channel configurators for onboarding: {@link ChannelPlugin.onboard} overrides {@link ChannelPlugin.setupWizard}.
 */

import type { ChannelPlugin } from '../../../../channels/plugin-types.js';
import {
  listChannelPlugins,
  syncChannelPluginsFromManager,
} from '../../../../channels/plugins/registry.js';
import { bundledChannelPlugins } from '../../../../generated/bundled-channel-plugins.js';
import type { ChannelConfigurator } from './types.js';
import { channelSetupWizardToConfigurator } from './wizard-to-configurator.js';
import { channelOnboardToConfigurator } from './onboard-to-configurator.js';

function ensureChannelRegistrySeeded(): void {
  if (listChannelPlugins().length === 0) {
    syncChannelPluginsFromManager(bundledChannelPlugins);
  }
}

function sortByMetaOrder(plugins: ChannelPlugin[]): ChannelPlugin[] {
  return [...plugins].sort((a, b) => {
    const oa = a.meta.order ?? 999;
    const ob = b.meta.order ?? 999;
    if (oa !== ob) return oa - ob;
    return a.id.localeCompare(b.id);
  });
}

export function getChannelConfigurators(): ChannelConfigurator[] {
  ensureChannelRegistrySeeded();
  const out: ChannelConfigurator[] = [];

  for (const plugin of sortByMetaOrder([...listChannelPlugins()])) {
    if (plugin.onboard) {
      out.push(channelOnboardToConfigurator(plugin));
    } else if (plugin.setupWizard) {
      out.push(
        channelSetupWizardToConfigurator(plugin.setupWizard, {
          name: plugin.meta.label,
          description: plugin.meta.blurb,
        }),
      );
    }
  }
  return out;
}
