export const RECURRING_WORK_SPEC_TAG = 'recurring-work-spec';

const STAGE_TAGS = {
  draft: 'recurring-work-draft',
  ready: 'recurring-work-ready',
  configured: 'recurring-work-configured',
} as const;

export type RecurringWorkStage = keyof typeof STAGE_TAGS | 'needs_review';

export function recurringWorkStage(tags: readonly string[] | undefined): RecurringWorkStage {
  const stages = (Object.entries(STAGE_TAGS) as Array<[keyof typeof STAGE_TAGS, string]>)
    .filter(([, tag]) => tags?.includes(tag));
  return stages.length === 1 ? stages[0][0] : 'needs_review';
}
