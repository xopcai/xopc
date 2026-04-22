/**
 * Controls which sections are included in the system prompt.
 *
 * - "full": All sections (default, for main agent)
 * - "minimal": Reduced sections (subagents, cron jobs)
 * - "none": Just basic identity line, no sections
 */
export type PromptMode = 'full' | 'minimal' | 'none';
