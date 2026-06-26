import type {
  ChannelActionDescriptor,
  ChannelConfigUiHint,
  ChannelContributionCapabilities,
  ChannelContributionUiDeclaration,
} from '../../extensions/types/manifest.js';

export type ChannelCatalogSource = 'workspace' | 'global' | 'bundled' | 'config';

export interface ChannelSetupIssue {
  code: string;
  severity: 'required' | 'warning';
  fieldPath?: string;
  message: string;
  action?: 'open_config' | 'run_setup' | 'run_doctor';
}

export interface ChannelSetupStatus {
  enabled: boolean;
  ready: boolean;
  state: 'disabled' | 'needs_setup' | 'ready' | 'error';
  issues: ChannelSetupIssue[];
}

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
  ui?: ChannelContributionUiDeclaration;
}

export interface ChannelCatalog {
  entries: ChannelCatalogEntry[];
  byId: Map<string, ChannelCatalogEntry>;
}
