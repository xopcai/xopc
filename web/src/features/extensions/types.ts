import type { PluginAccount } from './plugin-setup-types';
/** Page contribution (manifest `ui.contributions.pages`). */
export type PageContribution = {
  id: string;
  title: string;
  path: string;
  entrypoint: string;
  showInNav?: boolean;
  navIcon?: string;
};

/** Settings panel contribution (manifest `ui.contributions.settingsPanels`). */
export type SettingsPanelContribution = {
  id: string;
  title: string;
  entrypoint: string;
  order?: number;
};

export type ChatWidgetMatchSpec = {
  toolName?: string;
  contentType?: string;
  metadata?: Record<string, unknown>;
};

export type ChatWidgetContribution = {
  id: string;
  title: string;
  match: ChatWidgetMatchSpec;
  entrypoint: string;
  maxHeight?: number;
  interactive?: boolean;
};

export type ExtensionCommandContribution = {
  id: string;
  title: string;
  shortcut?: string;
  /** When set, run navigates to `/extensions/{extensionId}` for this extension. */
  opensPanel?: string;
  chatAlias?: string;
};

export type ExtensionUiContributions = {
  pages?: PageContribution[];
  settingsPanels?: SettingsPanelContribution[];
  chatWidgets?: ChatWidgetContribution[];
  commands?: ExtensionCommandContribution[];
};

/** Serialized extension list row from `GET /api/extensions`. */
export type ExtensionApiRow = {
  localizations?: Partial<Record<'en' | 'zh-CN', { displayName: string; description?: string }>>;
  branding?: { iconUrl: string; iconSha256: string };
  format?: 'native-extension' | 'agent-plugin';
  pluginId?: string;
  installationSource?: string;
  resolvedCommit?: string;
  workspacePaths?: string[] | null;
  dialect?: 'portable' | 'codex' | 'claude';
  installationState?: 'preparing' | 'installed';
  authorizationStatus?: 'required' | 'connected' | 'not_required';
  setup?: { authorizations?: PluginAccount[]; userConfig: Record<string, { type: string; title: string; required: boolean; sensitive: boolean; default?: string | number | boolean }>; tasks: string[] };
  canRollback?: boolean;
  readiness?: 'ready' | 'setup_required' | 'degraded' | 'blocked';
  components?: { skills: Array<{ name: string; description?: string }>; mcp: Array<{ name: string; id: string; type: string; connectionAuth?: { mode: string; headerName?: string; prefix?: string } }> };
  diagnostics?: Array<{ component: string; message: string }>;
  provenance?: {
    kind: 'store'; packageName: string; packageType: 'plugin' | 'extension'; version: string; sha256: string;
    publisherVerification?: 'community' | 'verified'; sourceRepository?: string; sourceCommit?: string;
    artifactFormat?: string; riskTier?: 'content' | 'network' | 'local-exec';
  };
  id: string;
  name: string;
  description?: string;
  version?: string;
  kind?: string;
  source: string;
  active: boolean;
  /** True if current config + activation rules would load this extension after a gateway restart. */
  activationEligible?: boolean;
  hasUi: boolean;
  /** True when manifest includes `configSchema` (for auto settings UI). */
  hasConfigSchema?: boolean;
  ui?: {
    icon?: string;
    permissions?: string[];
    contributions?: ExtensionUiContributions & Record<string, unknown>;
  };
};

/** UI-enabled extension info (alias for list row; used by extension navigators). */
export type ExtensionUiInfo = ExtensionApiRow;

/** `GET /api/extensions` response body. */
export type ExtensionsListResponse = {
  extensions: ExtensionApiRow[];
};
