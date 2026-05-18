export type MainTab = 'builtin' | 'user' | 'marketplace';
export type SourceFilter = 'all' | 'global' | 'workspace' | 'extra';

export const MAIN_TAB_SET = new Set<MainTab>(['builtin', 'user', 'marketplace']);
export const SOURCE_FILTER_SET = new Set<SourceFilter>(['all', 'global', 'workspace', 'extra']);

/** Hash query: which skills marketplace to browse (`store` | `skillhub`). */
export const MARKETPLACE_PROVIDER_PARAM = 'mprov';

export const SKILL_LIST_SKELETON_COUNT = 6;

/** Stable string keys for skeleton placeholders so we don't use array index as key. */
export const SKILL_LIST_SKELETON_KEYS = ['s0', 's1', 's2', 's3', 's4', 's5'] as const;

/** Category display order for consistent pill ordering on the built-in tab. */
export const BUILTIN_SKILL_CATEGORY_ORDER = [
  'business',
  'creative',
  'documents',
  'engineering',
  'tools',
] as const;
