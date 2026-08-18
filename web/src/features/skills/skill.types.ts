/** Skills catalog — managed global skills (~/.xopc/skills) and workspace skills (.xopc/skills). */

export type SkillInstallTarget = 'workspace' | 'global';

export interface SkillHubProvenance {
  kind: 'git' | 'archive';
  source: string;
  ref?: string;
  subpath?: string;
  contentHash: string;
  installedAt: string;
  updatedAt: string;
}

export type SkillOsId = 'darwin' | 'linux' | 'win32';

export interface SkillRequiresApi {
  bins?: string[];
  env?: string[];
  anyBins?: string[];
}

export interface SkillInstallSpecApi {
  id?: string;
  kind: string;
  package?: string;
  formula?: string;
  module?: string;
  url?: string;
  bins?: string[];
  label?: string;
  os?: SkillOsId[];
}

export interface SkillMetadataApi {
  name: string;
  description: string;
  emoji?: string;
  homepage?: string;
  os?: SkillOsId[];
  requires?: SkillRequiresApi;
  install?: SkillInstallSpecApi[];
  xopc?: {
    emoji?: string;
    requires?: SkillRequiresApi;
    install?: SkillInstallSpecApi[];
    os?: SkillOsId[];
  };
}

export interface SkillToolConditionsApi {
  requiresTools: string[];
  requiresToolsets: string[];
  fallbackForTools: string[];
  fallbackForToolsets: string[];
}

/** GET /api/skills/:name/content — matches gateway `SkillMarkdownPreviewPayload`. */
export interface SkillMarkdownPreviewPayload {
  name: string;
  description: string;
  bodyMarkdown: string;
  disableModelInvocation: boolean;
  metadata: SkillMetadataApi;
  toolConditions?: SkillToolConditionsApi;
  requiredEnvVarNames?: string[];
}

export interface SkillCatalogEntry {
  directoryId: string;
  name: string;
  description: string;
  /** Category derived from parent directory (e.g. skills/creative/algorithmic-art → 'creative') */
  category?: string;
  source: 'builtin' | 'workspace' | 'global' | 'extra';
  origin: 'extra' | 'bundled' | 'agents-global' | 'agents-workspace' | 'custom-global' | 'xopc-global' | 'xopc-workspace';
  path: string;
  managed: boolean;
  writable: boolean;
  /** User toggle (default true). */
  enabled: boolean;
  /** When true, skill is never shown to the model (SKILL.md). */
  disableModelInvocation: boolean;
  /** Present when installed via CLI `skills hub pull` (skills-lock.json). */
  hub?: SkillHubProvenance;
}

export interface SkillDiagnostic {
  type: 'skipped' | 'warning' | 'collision' | 'error';
  skillName?: string;
  message: string;
  path?: string;
}

export interface SkillRuntimeStatus {
  version: string;
  loadedAt: number;
  reloadInProgress: boolean;
  reloadPending: boolean;
  lastReloadStartedAt?: number;
  lastReloadFinishedAt?: number;
  lastReloadReason?: 'initial' | 'disk' | 'config' | 'trust';
  lastReloadOk?: boolean;
  lastReloadError?: string;
}

export interface ManagedSkillDir {
  id: string;
  name: string;
  description: string;
  path: string;
  hub?: SkillHubProvenance;
}

export interface SkillsPayload {
  catalog: SkillCatalogEntry[];
  managed: ManagedSkillDir[];
  version: string;
  loadedAt: number;
  diagnostics: SkillDiagnostic[];
  status: SkillRuntimeStatus;
}

export interface SkillInstallAvailability {
  skillId: string;
  skillName?: string;
  loaded: boolean;
  enabled?: boolean;
  defaultAgentId: string;
  availableForDefaultAgent?: boolean;
  unavailableReason?: 'agent-denied' | 'disabled' | 'requirements-unmet' | 'model-invocation-disabled' | null;
  diagnostics: SkillDiagnostic[];
}

export interface SkillInstallResultPayload {
  skillId: string;
  path: string;
  target?: SkillInstallTarget;
  availability?: SkillInstallAvailability;
}

export interface SkillSourceInstallResultPayload extends SkillInstallResultPayload {
  source: string;
  kind: 'git' | 'archive';
  contentHash: string;
}

/**
 * Marketplace provider identifier. Dynamic — extensions can register additional providers
 * via `api.registerMarketplaceAdapter()`. Built-in values: 'store', 'skillhub', 'clawhub'.
 */
export type MarketplaceProviderId = string;

/** GET /api/skills/marketplace/categories — provider-specific taxonomy. */
export interface MarketplaceCategoryItem {
  id: string;
  label: string;
}

/** GET /api/skills/marketplace — proxied xopc-store package list (type=skill). */
export interface MarketplacePackageItem {
  id: string;
  name: string;
  type: string;
  description: string;
  downloads: number;
  author: { username: string; avatarUrl: string | null };
  latestVersion?: string;
  updatedAt: string;
  categories?: string[];
  tags?: string[];
  stars?: number;
  sourceLabel?: string;
  /**
   * The marketplace provider id this row originated from. Used by aggregated search to install
   * / fetch detail from the correct adapter regardless of which provider the user is browsing.
   * Stamped client-side from the response envelope's top-level `provider` field — the backend
   * row schema is unchanged.
   */
  providerId?: MarketplaceProviderId;
  /**
   * Additional providers that returned the same logical package (matched by slug + displayName +
   * author) during aggregated search. Empty / absent for single-source rows.
   */
  additionalSources?: { providerId: MarketplaceProviderId; sourceLabel?: string }[];
}

export interface SkillsMarketplacePayload {
  items: MarketplacePackageItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  /** Current marketplace provider */
  provider?: string;
}

/** GET /api/skills/marketplace/packages/:name — store package detail for preview. */
export interface MarketplacePackageDetailPayload {
  id: string;
  name: string;
  type: string;
  description: string;
  readme: string | null;
  /** Gateway-normalized structured meta + body. */
  skillDocPreview: SkillMarkdownPreviewPayload;
  downloads: number;
  author: { username: string; avatarUrl: string | null };
  latestVersion: {
    version: string;
    changelog: string | null;
    publishedAt: string;
  };
  provider?: string;
}

/** Info about a single marketplace provider from the dynamic registry. */
export interface MarketplaceProviderInfo {
  id: string;
  displayName: string;
}
