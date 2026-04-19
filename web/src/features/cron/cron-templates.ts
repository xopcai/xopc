/** Non-display fields for scheduled-task templates; copy lives in i18n `cron.templates`. */

export const CRON_TEMPLATE_CATEGORIES = ['daily', 'monitoring', 'reports', 'automation'] as const;
export type CronTemplateCategory = (typeof CRON_TEMPLATE_CATEGORIES)[number];

export interface CronJobTemplateDef {
  templateId: string;
  category: CronTemplateCategory;
  defaultSchedule: string;
  defaultSessionTarget: 'isolated';
}

/** Grouped like common scheduled-task UIs: daily rhythm, external monitoring, periodic reports, repo automation. */
export const CRON_JOB_TEMPLATES = [
  // Daily
  {
    templateId: 'morning_briefing',
    category: 'daily',
    defaultSchedule: '0 7 * * 1-5',
    defaultSessionTarget: 'isolated',
  },
  {
    templateId: 'standup_prep',
    category: 'daily',
    defaultSchedule: '0 8 * * 1-5',
    defaultSessionTarget: 'isolated',
  },
  {
    templateId: 'end_of_day_wrap_up',
    category: 'daily',
    defaultSchedule: '0 18 * * 1-5',
    defaultSessionTarget: 'isolated',
  },
  {
    templateId: 'inbox_triage',
    category: 'daily',
    defaultSchedule: '30 8 * * 1-5',
    defaultSessionTarget: 'isolated',
  },
  // Monitoring
  {
    templateId: 'competitor_watch',
    category: 'monitoring',
    defaultSchedule: '0 9 * * 1',
    defaultSessionTarget: 'isolated',
  },
  {
    templateId: 'trending_topics_monitor',
    category: 'monitoring',
    defaultSchedule: '0 10 * * 1-5',
    defaultSessionTarget: 'isolated',
  },
  {
    templateId: 'tech_radar_stack',
    category: 'monitoring',
    defaultSchedule: '0 11 * * 3',
    defaultSessionTarget: 'isolated',
  },
  {
    templateId: 'dependency_check_audit',
    category: 'monitoring',
    defaultSchedule: '0 9 * * 0',
    defaultSessionTarget: 'isolated',
  },
  // Reports
  {
    templateId: 'weekly_review',
    category: 'reports',
    defaultSchedule: '0 17 * * 5',
    defaultSessionTarget: 'isolated',
  },
  {
    templateId: 'code_quality_report',
    category: 'reports',
    defaultSchedule: '0 14 * * 1',
    defaultSessionTarget: 'isolated',
  },
  {
    templateId: 'git_activity_summary',
    category: 'reports',
    defaultSchedule: '0 9 * * 1',
    defaultSessionTarget: 'isolated',
  },
  {
    templateId: 'user_feedback_digest',
    category: 'reports',
    defaultSchedule: '0 16 * * 5',
    defaultSessionTarget: 'isolated',
  },
  // Automation
  {
    templateId: 'stale_todo_or_issue_sweep',
    category: 'automation',
    defaultSchedule: '0 10 * * 2',
    defaultSessionTarget: 'isolated',
  },
  {
    templateId: 'release_notes_or_changelog_draft',
    category: 'automation',
    defaultSchedule: '0 10 * * 4',
    defaultSessionTarget: 'isolated',
  },
  {
    templateId: 'workspace_cleanup_suggestions',
    category: 'automation',
    defaultSchedule: '30 18 * * 5',
    defaultSessionTarget: 'isolated',
  },
  {
    templateId: 'smoke_or_ci_health_reminder',
    category: 'automation',
    defaultSchedule: '0 8 * * 1',
    defaultSessionTarget: 'isolated',
  },
] as const satisfies readonly CronJobTemplateDef[];

export type CronTemplateId = (typeof CRON_JOB_TEMPLATES)[number]['templateId'];

export function cronTemplateById(id: string): (typeof CRON_JOB_TEMPLATES)[number] | undefined {
  return CRON_JOB_TEMPLATES.find((t) => t.templateId === id);
}
