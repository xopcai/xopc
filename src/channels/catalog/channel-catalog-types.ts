import type {
  ChannelActionDescriptor,
  ChannelConfigUiHint,
  ChannelContributionCapabilities,
} from '../../extensions/types/manifest.js';

export type ChannelCatalogSource = 'workspace' | 'global' | 'bundled' | 'config';

export interface ChannelCatalogEntry {
  id: string;
  extensionId: string;
  source: ChannelCatalogSource;
  path: string;
  label: string;
  description?: string;
  docsPath?: string;
  order: number;
  configPath: `channels.${string}`;
  capabilities: ChannelContributionCapabilities;
  configSchema: Record<string, unknown>;
  uiHints: Record<string, ChannelConfigUiHint>;
  actions: Record<string, ChannelActionDescriptor>;
}

export interface ChannelCatalog {
  entries: ChannelCatalogEntry[];
  byId: Map<string, ChannelCatalogEntry>;
}
