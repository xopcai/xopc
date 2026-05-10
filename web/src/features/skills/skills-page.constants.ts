export type MainTab = 'builtin' | 'user' | 'marketplace';
export type SourceFilter = 'all' | 'global' | 'workspace' | 'extra';

export const MAIN_TAB_SET = new Set<MainTab>(['builtin', 'user', 'marketplace']);
export const SOURCE_FILTER_SET = new Set<SourceFilter>(['all', 'global', 'workspace', 'extra']);

export const SKILL_LIST_SKELETON_COUNT = 6;

/** Category display order for consistent pill ordering on the built-in tab. */
export const BUILTIN_SKILL_CATEGORY_ORDER = [
  'business',
  'creative',
  'documents',
  'engineering',
  'tools',
] as const;
