export const WORKFLOW_MAIN_TABS = ['catalog', 'active', 'history'] as const;
export type WorkflowMainTab = (typeof WORKFLOW_MAIN_TABS)[number];

export const WORKFLOW_MAIN_TAB_SET = new Set<string>(WORKFLOW_MAIN_TABS);

export const WORKFLOW_CATEGORY_FILTERS = ['all', 'code-review', 'planning', 'research'] as const;
export type WorkflowCategoryFilter = (typeof WORKFLOW_CATEGORY_FILTERS)[number];

export const WORKFLOW_CATEGORY_FILTER_SET = new Set<string>(WORKFLOW_CATEGORY_FILTERS);

export const WORKFLOW_SOURCE_FILTERS = ['all', 'builtin', 'user'] as const;
export type WorkflowSourceFilter = (typeof WORKFLOW_SOURCE_FILTERS)[number];

export const WORKFLOW_SOURCE_FILTER_SET = new Set<string>(WORKFLOW_SOURCE_FILTERS);

export const WORKFLOW_SEARCH_PARAM = 'q';
export const WORKFLOW_TAB_PARAM = 'tab';
export const WORKFLOW_RUN_PARAM = 'run';
export const WORKFLOW_DEF_PARAM = 'def';
export const WORKFLOW_START_PARAM = 'start';

/** Tag membership for category chips — first matching category wins in filters. */
export const WORKFLOW_CATEGORY_TAGS: Record<Exclude<WorkflowCategoryFilter, 'all'>, readonly string[]> = {
  'code-review': ['code-review', 'pr', 'release'],
  planning: ['planning', 'implementation', 'architecture', 'decision', 'review'],
  research: ['research', 'investigation', 'debug', 'incident', 'troubleshooting'],
};

export interface WorkflowArgFieldDef {
  key: string;
  labelKey: string;
  placeholderKey: string;
  required?: boolean;
  multiline?: boolean;
}

export const WORKFLOW_ARG_FIELDS: Record<string, WorkflowArgFieldDef[]> = {
  research: [
    {
      key: 'question',
      labelKey: 'argQuestion',
      placeholderKey: 'argQuestionPlaceholder',
      required: true,
      multiline: true,
    },
  ],
  multi_perspective_review: [
    {
      key: 'target',
      labelKey: 'argTarget',
      placeholderKey: 'argTargetPlaceholder',
      multiline: true,
    },
  ],
  pr_review: [
    {
      key: 'target',
      labelKey: 'argDiff',
      placeholderKey: 'argDiffPlaceholder',
      multiline: true,
    },
  ],
  debug_incident: [
    {
      key: 'error',
      labelKey: 'argError',
      placeholderKey: 'argErrorPlaceholder',
      required: true,
      multiline: true,
    },
    {
      key: 'context',
      labelKey: 'argContext',
      placeholderKey: 'argContextPlaceholder',
      multiline: true,
    },
  ],
  implementation_plan: [
    {
      key: 'request',
      labelKey: 'argRequest',
      placeholderKey: 'argRequestPlaceholder',
      required: true,
      multiline: true,
    },
    {
      key: 'scope',
      labelKey: 'argScope',
      placeholderKey: 'argScopePlaceholder',
    },
  ],
  release_check: [
    {
      key: 'target',
      labelKey: 'argTarget',
      placeholderKey: 'argReleaseTargetPlaceholder',
      multiline: true,
    },
  ],
};

export const ACTIVE_RUN_STATUSES = new Set(['queued', 'running']);
export const HISTORY_RUN_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timeout']);

export const RUN_FETCH_LIMIT = 100;
