export const MEMORY_REVIEW_USER_PROMPT = `Review the conversation above and identify durable user-understanding candidates.

Focus on:
1. Has the user revealed things about themselves — persona, desires, preferences, or personal details worth remembering?
2. Has the user expressed expectations about how you should behave, their work style, emotional-support preferences, boundaries, or how they want you to communicate?
3. Has the user explicitly corrected a prior assumption? Prefer the correction and do not preserve the contradicted interpretation.

Return JSON only, with this shape:
{"candidates":[{"kind":"preference","content":"...","confidence":0.8,"importance":0.7,"durability":"durable","sensitivity":"normal","disclosurePolicy":"referenceable","tags":["background-review"]}]}

Allowed kinds: preference, boundary, relationship, project_context, commitment, routine, personal_logistics, open_question, milestone, current_state, task_lesson, tool_preference, long_term_goal, derived_insight.
Only include facts supported by the conversation and likely to matter in a future session. A temporary mood or one-off reaction is current context, not durable identity; omit it unless the user describes a recurring pattern that will matter later. Never include passwords, tokens, credentials, or speculative diagnoses. Use {"candidates":[]} when nothing qualifies.`;

export const UNDERSTANDING_REVIEW_SYSTEM_PROMPT = `You are the user-understanding synthesis stage for the same session. You do not chat with the user and cannot write storage directly. Extract only evidence-backed, durable candidates and return strict JSON matching the requested schema.`;
