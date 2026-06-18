/**
 * Channel configurators for onboarding: {@link ChannelPlugin.onboard} overrides {@link ChannelPlugin.setupWizard}.
 */

import type { ChannelPlugin } from '../../../../channels/plugin-types.js';
import { listChannelPlugins } from '../../../../channels/plugins/registry.js';
import { ExtensionLoader } from '../../../../extensions/loader.js';
import {
  buildExtensionMetadataSnapshot,
  resolveExtensionLoaderOptionsFromConfig,
} from '../../../../extensions/extension-metadata-snapshot.js';
import type { Config } from '../../../../config/schema.js';
import type { ResolvedExtensionConfig } from '../../../../extensions/types/index.js';
import type { ChannelConfigurator } from './types.js';
import { channelSetupWizardToConfigurator } from './wizard-to-configurator.js';
import { channelOnboardToConfigurator } from './onboard-to-configurator.js';

function sortByMetaOrder(plugins: ChannelPlugin[]): ChannelPlugin[] {
  return [...plugins].sort((a, b) => {
    const oa = a.meta.order ?? 999;
    const ob = b.meta.order ?? 999;
    if (oa !== ob) return oa - ob;
    return a.id.localeCompare(b.id);
  });
}

function toConfigurators(plugins: readonly ChannelPlugin[]): ChannelConfigurator[] {
  const out: ChannelConfigurator[] = [];

  for (const plugin of sortByMetaOrder([...plugins])) {
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

async function loadChannelPluginsForOnboard(config: Config): Promise<ChannelPlugin[]> {
  const snapshot = buildExtensionMetadataSnapshot(resolveExtensionLoaderOptionsFromConfig(config), config);
  const extensionConfigs: ResolvedExtensionConfig[] = [];

  for (const entry of snapshot.manifestRegistry.getAllEntries()) {
    if (!entry.manifest.channelContributions || Object.keys(entry.manifest.channelContributions).length === 0) {
      continue;
    }
    extensionConfigs.push({
      id: entry.id,
      name: entry.manifest.name || entry.id,
      source: entry.source,
      path: entry.path,
      enabled: true,
      config: {},
    });
  }

  if (extensionConfigs.length === 0) {
    return [];
  }

  const loader = new ExtensionLoader(resolveExtensionLoaderOptionsFromConfig(config));
  loader.setConfig(config);
  loader.setManifestSnapshot(snapshot);
  await loader.loadExtensions(extensionConfigs);
  return loader.getRegistry().channelPlugins;
}

export async function getChannelConfigurators(config: Config): Promise<ChannelConfigurator[]> {
  const registered = listChannelPlugins();
  if (registered.length > 0) {
    return toConfigurators(registered);
  }
  return toConfigurators(await loadChannelPluginsForOnboard(config));
}
