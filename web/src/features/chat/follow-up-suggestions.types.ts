/** Stable ids; chip labels come from i18n (`messages.chat.followUpChip*`). */
export type FollowUpSuggestionId =
  | 'code_error_handling'
  | 'code_refactor'
  | 'code_explain'
  | 'code_optimize'
  | 'code_add_tests'
  | 'code_fix_error'
  | 'web_more_details'
  | 'web_find_sources'
  | 'web_verify_claim'
  | 'research_deeper'
  | 'date_shorter_summary'
  | 'date_main_risks'
  | 'email_make_formal'
  | 'email_shorten'
  | 'generic_simpler_terms'
  | 'generic_concrete_example'
  | 'generic_bullet_points'
  | 'generic_create_table'
  | 'generic_action_checklist'
  | 'generic_assumptions'
  | 'learn_technical_detail'
  | 'learn_build_walkthrough'
  | 'learn_compare_alternatives'
  | 'wf_run_checks'
  | 'wf_git_commit'
  | 'wf_compare_options'
  | 'wf_verify_acceptance'
  | 'ops_fix_config'
  | 'ops_channel_next'
  | 'ops_schedule_cron'
  | 'what_next';

export const FOLLOW_UP_SUGGESTION_IDS: readonly FollowUpSuggestionId[] = [
  'code_error_handling',
  'code_refactor',
  'code_explain',
  'code_optimize',
  'code_add_tests',
  'code_fix_error',
  'web_more_details',
  'web_find_sources',
  'web_verify_claim',
  'research_deeper',
  'date_shorter_summary',
  'date_main_risks',
  'email_make_formal',
  'email_shorten',
  'generic_simpler_terms',
  'generic_concrete_example',
  'generic_bullet_points',
  'generic_create_table',
  'generic_action_checklist',
  'generic_assumptions',
  'learn_technical_detail',
  'learn_build_walkthrough',
  'learn_compare_alternatives',
  'wf_run_checks',
  'wf_git_commit',
  'wf_compare_options',
  'wf_verify_acceptance',
  'ops_fix_config',
  'ops_channel_next',
  'ops_schedule_cron',
  'what_next',
] as const;
