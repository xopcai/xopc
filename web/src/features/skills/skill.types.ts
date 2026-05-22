/** Skills catalog — managed global skills (~/.xopc/skills). */

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
  path: string;
  managed: boolean;
  /** User toggle (default true). */
  enabled: boolean;
  /** When true, skill is never shown to the model (SKILL.md). */
  disableModelInvocation: boolean;
  /** Present when installed via CLI `skills hub pull` (skills-lock.json). */
  hub?: SkillHubProvenance;
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
  /** Present for SkillHub SKILL.md (and similar) so the UI can render structured meta + body. */
  skillDocPreview?: SkillMarkdownPreviewPayload;
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
