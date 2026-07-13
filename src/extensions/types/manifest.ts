/**
 * Extension manifest — control-plane metadata (readable without loading extension code).
 */

import type { ExtensionKind } from './core.js';

/** Declared in `engines` in the extension manifest (e.g. VSCode-style). */
export interface EnginesDeclaration {
  /** Semver range string for the running xopc CLI / gateway, e.g. `">=0.0.20"`. */
  xopc?: string;
  /** Stable backend extension SDK API range, independent from the host package version. */
  extensionApi?: string;
  /** Stable iframe UI SDK API range, independent from the host package version. */
  extensionUiApi?: string;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  description?: string;
  version?: string;
  kind?: ExtensionKind;
  main?: string;
  configSchema?: Record<string, unknown>;
  dependencies?: Record<string, string>;

  enabledByDefault?: boolean;

  providers?: string[];
  /** Speech/TTS provider ids implemented by this extension. */
  speechProviders?: string[];
  /** Media understanding (STT/image/video) provider ids implemented by this extension. */
  mediaUnderstandingProviders?: string[];
  providerAuthEnvVars?: Record<string, string[]>;
  providerAuthChoices?: ProviderAuthChoice[];
  modelSupport?: ModelSupportDeclaration;
  autoEnableWhenConfiguredProviders?: string[];

  channels?: string[];
  channelEnvVars?: Record<string, string[]>;
  channelContributions?: Record<string, ChannelContributionDeclaration>;

  activation?: ActivationDeclaration;
  contracts?: ContractDeclaration;
  setup?: SetupDeclaration;

  /** Hot-reload: config path prefixes and capability flags (optional; handlers can register at runtime). */
  reload?: {
    configPrefixes?: string[];
    supportsHotReload?: boolean;
  };

  /**
   * Host / runtime requirements (e.g. compatible xopc semver range).
   * Normalized from `xopc.extension.json` `engines`.
   */
  engines?: EnginesDeclaration;

  /** Chat commands metadata (runtime registration still required in `register()`). */
  commands?: ExtensionManifestCommand[];

  /** Frontend UI declaration — enables extensions to render custom UI in the Gateway Console. */
  ui?: ExtensionUiManifest;
}

export interface ChannelConfigUiHint {
  label?: string;
  help?: string;
  tags?: string[];
  advanced?: boolean;
  sensitive?: boolean;
  placeholder?: string;
  itemTemplate?: unknown;
}

export interface ChannelContributionCapabilities {
  login?: boolean;
  pairing?: boolean;
  doctor?: boolean;
  multiAccount?: boolean;
  streaming?: boolean;
  media?: boolean;
  [key: string]: unknown;
}

export interface ChannelActionDescriptor {
  label?: string;
  description?: string;
  result?: 'ok' | 'qr' | 'poll' | 'diagnostics' | 'form';
  schema?: Record<string, unknown>;
}

export interface ChannelContributionI18n {
  label?: string;
  description?: string;
  configSchema?: Record<string, unknown>;
  uiHints?: Record<string, ChannelConfigUiHint>;
  actions?: Record<string, ChannelActionDescriptor>;
  ui?: ChannelContributionUiDeclaration;
}

export interface ChannelContributionDeclaration {
  label: string;
  description?: string;
  docsPath?: string;
  order?: number;
  configPath?: string;
  capabilities?: ChannelContributionCapabilities;
  configSchema?: Record<string, unknown>;
  uiHints?: Record<string, ChannelConfigUiHint>;
  actions?: Record<string, ChannelActionDescriptor>;
  ui?: ChannelContributionUiDeclaration;
  i18n?: Record<string, ChannelContributionI18n>;
}

export interface ChannelContributionUiDeclaration {
  icon?: string;
  card?: {
    primaryAction?: string;
    summaryFields?: string[];
  };
  modal?: {
    entrypoint?: string;
    minHeight?: number;
    maxHeight?: number;
    permissions?: ExtensionUiPermission[];
    placement?: 'before-config' | 'after-setup' | 'replace-config';
  };
}

export interface ExtensionManifestCommand {
  name: string;
  description: string;
  aliases?: string[];
  scope?: Array<'global' | 'private' | 'group'>;
  examples?: string[];
}

/** Top-level UI declaration within an extension manifest. */
export interface ExtensionUiManifest {
  /** Frontend entry HTML (relative to extension root). */
  main?: string;
  /** Extension icon path (relative to extension root; SVG recommended). */
  icon?: string;
  /** Frontend permissions the extension requires. */
  permissions?: ExtensionUiPermission[];
  /** UI contribution points — where the extension renders in the Gateway Console. */
  contributions?: ExtensionUiContributions;
}

/** Permissions an extension can request for its frontend UI. */
export type ExtensionUiPermission =
  | 'agent.send'
  | 'agent.subscribe'
  | 'session.read'
  | 'session.write'
  | 'config.read'
  | 'config.write'
  | 'storage'
  | 'notification'
  | 'clipboard'
  | 'theme'
  | 'workspace.read'
  | 'workspace.write';

/** All UI contribution points an extension can declare. */
export interface ExtensionUiContributions {
  sidebarPanels?: SidebarPanelContribution[];
  settingsPanels?: SettingsPanelContribution[];
  chatWidgets?: ChatWidgetContribution[];
  pages?: PageContribution[];
  commands?: CommandContribution[];
  statusBarItems?: StatusBarItemContribution[];
}

/** A panel rendered in the sidebar area. */
export interface SidebarPanelContribution {
  id: string;
  title: string;
  icon?: string;
  entrypoint: string;
  defaultVisible?: boolean;
  /** When-expression for visibility (see Phase 2). */
  when?: string;
}

/** A panel rendered inside the settings page. */
export interface SettingsPanelContribution {
  id: string;
  title: string;
  entrypoint: string;
  order?: number;
}

/** A widget rendered inline within the chat message stream. */
export interface ChatWidgetContribution {
  id: string;
  title: string;
  match: ChatWidgetMatch;
  entrypoint: string;
  maxHeight?: number;
  interactive?: boolean;
}

export interface ChatWidgetMatch {
  toolName?: string;
  contentType?: string;
  metadata?: Record<string, unknown>;
}

/** A full-screen page registered as a route. */
export interface PageContribution {
  id: string;
  title: string;
  /** Relative path; host may mount under `/extensions/` (see Phase 2). */
  path: string;
  entrypoint: string;
  showInNav?: boolean;
  /** Lucide icon name */
  navIcon?: string;
  when?: string;
}

/** A command registered in the command palette. */
export interface CommandContribution {
  id: string;
  title: string;
  shortcut?: string;
  opensPanel?: string;
  /** Optional chat slash name (e.g. `/hello`); bound via `api.onCommand`. */
  chatAlias?: string;
  when?: string;
}

/** A small widget rendered in the status bar. */
export interface StatusBarItemContribution {
  id: string;
  entrypoint: string;
  position?: 'left' | 'right';
  width?: number;
  when?: string;
}

export interface ProviderAuthChoice {
  provider: string;
  method: 'api-key' | 'oauth' | 'cli' | 'env';
  choiceId: string;
  choiceLabel: string;
  choiceHint?: string;
  groupId?: string;
  groupLabel?: string;
  groupHint?: string;
  cliFlag?: string;
  cliOption?: string;
  cliDescription?: string;
}

export interface ModelSupportDeclaration {
  modelPrefixes?: string[];
  modelPatterns?: string[];
}

export interface ActivationDeclaration {
  /** When false, extension code loads after gateway ready (sidecar). Default: eager at startup. */
  onStartup?: boolean;
  onProviders?: string[];
  onCommands?: string[];
  onChannels?: string[];
  onCapabilities?: Array<'provider' | 'channel' | 'tool' | 'hook'>;
}

export interface ContractDeclaration {
  tools?: string[];
  hooks?: string[];
  commands?: string[];
  cliCommands?: string[];
  channels?: string[];
  httpRoutes?: string[];
  gatewayMethods?: string[];
  services?: string[];
  tui?: string[];
  providers?: string[];
  marketplaceAdapters?: string[];
  mediaUnderstandingProviders?: string[];
  speechProviders?: string[];
  imageGenerationProviders?: string[];
  webSearchProviders?: string[];
  memoryProviders?: string[];
}

export interface SetupDeclaration {
  providers?: SetupProviderDeclaration[];
  requiresRuntime?: boolean;
}

export interface SetupProviderDeclaration {
  id: string;
  authMethods?: string[];
  envVars?: string[];
}
