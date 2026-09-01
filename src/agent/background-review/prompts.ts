import { USER_FACING_UNDERSTANDING_WRITING_GUIDANCE } from '../../user-context/understanding-writing.js';

export const UNDERSTANDING_INTERPRETER_SYSTEM_PROMPT = `You are xopc's user-understanding interpreter. You do not chat with the user and cannot write storage. Distinguish memory commands, memory questions, corrections, forgetting, durable user assertions, and ordinary task requests. Return strict JSON only. Never treat assistant text as evidence of a fact about the user.`;

export function buildUnderstandingInterpreterPrompt(options: {
  mode: 'turn' | 'transcript';
  availableTargets?: Array<{ id: string; statement: string }>;
}): string {
  const targets = options.availableTargets?.length
    ? `\nOnly these understanding IDs may be targeted for confirm, correction, or forgetting:\n${options.availableTargets.map((item) => `- ${item.id}: ${item.statement}`).join('\n')}`
    : '\nNo existing understanding IDs are available to target.';
  return `Interpret the evidence-tagged conversation above for ${options.mode === 'turn' ? 'the latest user turn' : 'durable transcript synthesis'}.

Return exactly this JSON shape:
{"intent":"none","candidates":[],"targetUnderstandingIds":[],"abstentionReason":"..."}

Allowed intents: memory_create, memory_query, memory_confirm, memory_correct, memory_forget, user_assertion, task_request, none.

Candidate shape:
{"factKey":"communication:concise","statement":"...","kind":"preference","explicitness":"observed","durability":"durable","scopeHint":"global","confidence":0.8,"importance":0.7,"sensitivity":"normal","disclosurePolicy":"referenceable","evidence":[{"ref":"entry-id","quote":"exact quote from that user message"}],"selfContained":true,"unresolvedReferences":[]}

Allowed kinds: preference, boundary, relationship, routine, current_state, long_term_goal, project_context, task_lesson, derived_insight.

Rules:
- A question such as “Do you remember this goal?” is memory_query and creates no candidate.
- A request to create, summarize, update, investigate, or track a goal is task_request, not a user goal.
- Every candidate needs an exact quote from one or more user messages. Assistant messages may resolve context but never count as evidence.
- Extract zero to eight independent candidates; do not collapse multiple facts into one.
- factKey must be a stable language-neutral lowercase identifier using letters, digits, colons, or hyphens. Equivalent facts in different languages must use the same factKey.
- Set selfContained=false and list unresolvedReferences for unresolved words such as this, that, it, 这个, 那个, or 它.
- Omit temporary reactions and one-off task instructions.
- Never include passwords, credentials, regulated identifiers, or speculative diagnoses.
- For transcript mode, use explicitness=inferred unless the latest user message is itself an explicit memory command or correction.
- If evidence is insufficient, return candidates=[] and explain abstentionReason.

${USER_FACING_UNDERSTANDING_WRITING_GUIDANCE}
${targets}`;
}
