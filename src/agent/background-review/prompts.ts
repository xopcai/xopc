import { USER_FACING_UNDERSTANDING_WRITING_GUIDANCE } from '../../user-context/understanding-writing.js';

export const MEMORY_REVIEW_USER_PROMPT = `Review the conversation above and identify durable user-understanding candidates.

Focus on:
1. Has the user revealed things about themselves — persona, desires, preferences, or personal details worth remembering?
2. Has the user expressed expectations about how you should behave, their work style, emotional-support preferences, boundaries, or how they want you to communicate?
3. Has the user explicitly corrected a prior assumption? Prefer the correction and do not preserve the contradicted interpretation.

Return JSON only, with this shape:
{"candidates":[{"kind":"preference","content":"...","confidence":0.8,"importance":0.7,"durability":"durable","sensitivity":"normal","disclosurePolicy":"referenceable","tags":["background-review"]}]}

Allowed kinds: preference, boundary, relationship, routine, current_state, long_term_goal, project_context, task_lesson, derived_insight.
Only include facts supported by the conversation and likely to matter in a future session. A temporary mood or one-off reaction is current context, not durable identity; omit it unless the user describes a recurring pattern that will matter later. Never include passwords, tokens, credentials, or speculative diagnoses. Use {"candidates":[]} when nothing qualifies.

${USER_FACING_UNDERSTANDING_WRITING_GUIDANCE}

Do not turn a request about the current task into user understanding. Exclude requested outputs, follow-up instructions, project-note edits, investigations, and other one-off work. Every candidate must be a complete standalone profile statement or enduring pattern; never return a clause fragment beginning with a connector such as "and", "also", "并且", "以及", or "的事项". Use long_term_goal only when the person states an enduring personal goal, not when they ask the assistant to create, update, investigate, summarize, or track something.`;

export const UNDERSTANDING_REVIEW_SYSTEM_PROMPT = `You are the user-understanding synthesis stage for the same session. You do not chat with the user and cannot write storage directly. Extract only evidence-backed, durable candidates and return strict JSON matching the requested schema.`;
