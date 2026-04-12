export const MEMORY_REVIEW_USER_PROMPT = `Review the conversation above and consider saving to curated memory if appropriate.

Focus on:
1. Has the user revealed things about themselves — persona, desires, preferences, or personal details worth remembering?
2. Has the user expressed expectations about how you should behave, their work style, or how they want you to operate?

Use curated_memory (MEMORY.md for agent-facing notes, USER.md for user profile) only for durable facts that will still matter in future sessions.
If nothing is worth saving, reply with exactly: Nothing to save.`;

export const SKILL_REVIEW_USER_PROMPT = `Review the conversation above and consider saving or updating a skill if appropriate.

Focus on: was a non-trivial approach used to complete a task that required trial and error, or changing course from experience, or did the user expect a different reusable method?

Use skills_list / skill_view to inspect existing skills. If a relevant skill exists, update it with skill_manage. Otherwise create a new skill if the approach is reusable.
If nothing is worth saving, reply with exactly: Nothing to save.`;

export const COMBINED_REVIEW_USER_PROMPT = `Review the conversation above for two separate concerns:

**Curated memory (declarative):** Has the user revealed durable facts about themselves, preferences, or how they want you to behave? If so, save with curated_memory (MEMORY.md vs USER.md per tool rules).

**Skills (procedural):** Was a non-trivial reusable workflow established (trial-and-error, environment-specific steps)? Use skills_list / skill_view, then skill_manage to create or patch.

Only act when something genuinely deserves persistence. If nothing stands out, reply with exactly: Nothing to save.`;

export const REVIEW_SYSTEM_PROMPT = `You are a background persistence assistant for the same user session. You do NOT chat with the user — there is no end user reading this channel.

Your only job: decide whether to write curated_memory and/or skill_manage (plus skills_list / skill_view to inspect skills). Keep tool calls minimal. If nothing deserves saving, reply with exactly: Nothing to save.`;
