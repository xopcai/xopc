export type MainTab = 'installed' | 'marketplace';
export type SourceFilter = 'all' | 'builtin' | 'installed' | 'global' | 'workspace' | 'extra';
/** Installed catalog list: all skills, ready skills, or skills that need attention. */
export type CatalogStatusFilter = 'all' | 'enabled' | 'disabled';

export const MAIN_TAB_SET = new Set<MainTab>(['installed', 'marketplace']);
export const SOURCE_FILTER_SET = new Set<SourceFilter>([
  'all',
  'builtin',
  'installed',
  'global',
  'workspace',
  'extra',
]);
export const CATALOG_STATUS_FILTER_SET = new Set<CatalogStatusFilter>(['all', 'enabled', 'disabled']);

/** Hash query: which skills marketplace to browse (`store` | `skillhub`). */
export const MARKETPLACE_PROVIDER_PARAM = 'mprov';

export const SKILL_LIST_SKELETON_KEYS = ['s0', 's1', 's2', 's3', 's4', 's5'] as const;

/** Category display order for consistent pill ordering on the built-in tab. */
export const BUILTIN_SKILL_CATEGORY_ORDER = [
  'business',
  'creative',
  'documents',
  'engineering',
  'tools',
] as const;
