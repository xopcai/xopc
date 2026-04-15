/**
 * Extension manifest — control-plane metadata (readable without loading extension code).
 * New fields are optional for backward compatibility.
 */

import type { ExtensionKind } from './core.js';

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
  legacyExtensionIds?: string[];

  providers?: string[];
  providerAuthEnvVars?: Record<string, string[]>;
  providerAuthChoices?: ProviderAuthChoice[];
  modelSupport?: ModelSupportDeclaration;
  autoEnableWhenConfiguredProviders?: string[];

  channels?: string[];
  channelEnvVars?: Record<string, string[]>;

  activation?: ActivationDeclaration;
  contracts?: ContractDeclaration;
  setup?: SetupDeclaration;

  /** Frontend UI declaration — enables extensions to render custom UI in the Gateway Console. */
  ui?: ExtensionUiManifest;
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
  /** Relative path; host may mount under `/apps/` (see Phase 2). */
  path: string;
  entrypoint: string;
  showInNav?: boolean;
  /** Lucide icon name */
  navIcon?: string;
}

/** A command registered in the command palette. */
export interface CommandContribution {
  id: string;
  title: string;
  shortcut?: string;
  opensPanel?: string;
}

/** A small widget rendered in the status bar. */
export interface StatusBarItemContribution {
  id: string;
  entrypoint: string;
  position?: 'left' | 'right';
  width?: number;
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
  onProviders?: string[];
  onCommands?: string[];
  onChannels?: string[];
  onCapabilities?: Array<'provider' | 'channel' | 'tool' | 'hook'>;
}

export interface ContractDeclaration {
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
