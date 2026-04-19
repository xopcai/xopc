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

export interface SkillCatalogEntry {
  directoryId: string;
  name: string;
  description: string;
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
}

export interface SkillsMarketplacePayload {
  items: MarketplacePackageItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
