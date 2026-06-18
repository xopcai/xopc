export const WORKFLOW_MAIN_TABS = ['catalog', 'active', 'history'] as const;
export type WorkflowMainTab = (typeof WORKFLOW_MAIN_TABS)[number];

export const WORKFLOW_MAIN_TAB_SET = new Set<string>(WORKFLOW_MAIN_TABS);

export const WORKFLOW_CATEGORY_FILTERS = [
  'all',
  'code-review',
  'planning',
  'research',
  'writing',
  'productivity',
] as const;
export type WorkflowCategoryFilter = (typeof WORKFLOW_CATEGORY_FILTERS)[number];

export const WORKFLOW_CATEGORY_FILTER_SET = new Set<string>(WORKFLOW_CATEGORY_FILTERS);

export const WORKFLOW_SOURCE_FILTERS = ['all', 'builtin', 'user'] as const;
export type WorkflowSourceFilter = (typeof WORKFLOW_SOURCE_FILTERS)[number];

export const WORKFLOW_SOURCE_FILTER_SET = new Set<string>(WORKFLOW_SOURCE_FILTERS);

export const WORKFLOW_SEARCH_PARAM = 'q';
export const WORKFLOW_WF_FILTER_PARAM = 'wf';
export const WORKFLOW_AGENT_PARAM = 'agent';
/** @deprecated Legacy deep links — cleaned on load */
export const WORKFLOW_TAB_PARAM = 'tab';
export const WORKFLOW_RUN_PARAM = 'run';
export const WORKFLOW_TRIGGER_FILTER_PARAM = 'trigger';
export const WORKFLOW_DEF_PARAM = 'def';
export const WORKFLOW_START_PARAM = 'start';

export const WORKFLOW_TRIGGER_FILTERS = ['all', 'cron', 'webui', 'chat', 'api'] as const;
export type WorkflowTriggerFilter = (typeof WORKFLOW_TRIGGER_FILTERS)[number];

/** Tag membership for category chips — first matching category wins in filters. */
export const WORKFLOW_CATEGORY_ORDER: Exclude<WorkflowCategoryFilter, 'all'>[] = [
  'code-review',
  'planning',
  'research',
  'writing',
  'productivity',
];

export const WORKFLOW_CATEGORY_TAGS: Record<Exclude<WorkflowCategoryFilter, 'all'>, readonly string[]> = {
  'code-review': ['code-review', 'pr', 'release'],
  planning: ['planning', 'implementation', 'architecture', 'decision', 'review'],
  research: ['research', 'investigation', 'debug', 'incident', 'troubleshooting'],
  writing: ['writing', 'content', 'communication', 'email', 'document'],
  productivity: ['productivity', 'meeting', 'comparison', 'brainstorm', 'decision-making'],
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
  content_draft: [
    {
      key: 'topic',
      labelKey: 'argTopic',
      placeholderKey: 'argTopicPlaceholder',
      required: true,
      multiline: true,
    },
    {
      key: 'audience',
      labelKey: 'argAudience',
      placeholderKey: 'argAudiencePlaceholder',
    },
    {
      key: 'format',
      labelKey: 'argFormat',
      placeholderKey: 'argFormatPlaceholder',
    },
  ],
  decision_compare: [
    {
      key: 'question',
      labelKey: 'argDecisionQuestion',
      placeholderKey: 'argDecisionQuestionPlaceholder',
      required: true,
      multiline: true,
    },
    {
      key: 'options',
      labelKey: 'argOptions',
      placeholderKey: 'argOptionsPlaceholder',
      multiline: true,
    },
    {
      key: 'criteria',
      labelKey: 'argCriteria',
      placeholderKey: 'argCriteriaPlaceholder',
      multiline: true,
    },
  ],
  meeting_prep: [
    {
      key: 'meeting_topic',
      labelKey: 'argMeetingTopic',
      placeholderKey: 'argMeetingTopicPlaceholder',
      required: true,
      multiline: true,
    },
    {
      key: 'attendees',
      labelKey: 'argAttendees',
      placeholderKey: 'argAttendeesPlaceholder',
    },
    {
      key: 'goal',
      labelKey: 'argMeetingGoal',
      placeholderKey: 'argMeetingGoalPlaceholder',
      multiline: true,
    },
  ],
  weekly_review: [
    {
      key: 'wins',
      labelKey: 'argWins',
      placeholderKey: 'argWinsPlaceholder',
      required: true,
      multiline: true,
    },
    {
      key: 'blockers',
      labelKey: 'argBlockers',
      placeholderKey: 'argBlockersPlaceholder',
      multiline: true,
    },
    {
      key: 'carryover',
      labelKey: 'argCarryover',
      placeholderKey: 'argCarryoverPlaceholder',
      multiline: true,
    },
  ],
  client_proposal: [
    {
      key: 'client_brief',
      labelKey: 'argClientBrief',
      placeholderKey: 'argClientBriefPlaceholder',
      required: true,
      multiline: true,
    },
    {
      key: 'offer',
      labelKey: 'argOffer',
      placeholderKey: 'argOfferPlaceholder',
      multiline: true,
    },
    {
      key: 'budget_hint',
      labelKey: 'argBudgetHint',
      placeholderKey: 'argBudgetHintPlaceholder',
    },
  ],
  content_repurpose: [
    {
      key: 'source',
      labelKey: 'argSource',
      placeholderKey: 'argSourcePlaceholder',
      required: true,
      multiline: true,
    },
    {
      key: 'platforms',
      labelKey: 'argPlatforms',
      placeholderKey: 'argPlatformsPlaceholder',
      multiline: true,
    },
  ],
  competitor_scan: [
    {
      key: 'market',
      labelKey: 'argMarket',
      placeholderKey: 'argMarketPlaceholder',
      required: true,
      multiline: true,
    },
    {
      key: 'competitors',
      labelKey: 'argCompetitors',
      placeholderKey: 'argCompetitorsPlaceholder',
      multiline: true,
    },
    {
      key: 'focus',
      labelKey: 'argFocus',
      placeholderKey: 'argFocusPlaceholder',
    },
  ],
  offer_design: [
    {
      key: 'skills',
      labelKey: 'argSkills',
      placeholderKey: 'argSkillsPlaceholder',
      required: true,
      multiline: true,
    },
    {
      key: 'audience',
      labelKey: 'argOfferAudience',
      placeholderKey: 'argOfferAudiencePlaceholder',
      multiline: true,
    },
    {
      key: 'constraints',
      labelKey: 'argConstraints',
      placeholderKey: 'argConstraintsPlaceholder',
      multiline: true,
    },
  ],
  inbox_triage: [
    {
      key: 'inbox',
      labelKey: 'argInbox',
      placeholderKey: 'argInboxPlaceholder',
      required: true,
      multiline: true,
    },
    {
      key: 'priorities',
      labelKey: 'argPriorities',
      placeholderKey: 'argPrioritiesPlaceholder',
      multiline: true,
    },
  ],
};

export const ACTIVE_RUN_STATUSES = new Set(['queued', 'running']);
export const HISTORY_RUN_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timeout']);

export const RUN_FETCH_LIMIT = 100;
