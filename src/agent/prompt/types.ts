/**
 * Controls which sections are included in the system prompt.
 *
 * - "full": All sections (default, for main agent)
 * - "minimal": Reduced sections (subagents, automations)
 * - "voice": Spoken interaction with identity, trust, memory and coordination retained
 * - "none": Just basic identity line, no sections
 */
export type PromptMode = 'full' | 'minimal' | 'voice' | 'none';

/** Runtime responsibility, independent of prompt verbosity or the Agent's name. */
export type PromptRole = 'personal' | 'executor';

/** Controls the generic silent-reply section. Channel-aware callers can set "none". */
export type SilentReplyPromptMode = 'generic' | 'none';

export type MemoryCitationsMode = 'on' | 'off' | 'source-only';
