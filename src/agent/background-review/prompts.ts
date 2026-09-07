export const USER_MODEL_INTERPRETER_SYSTEM_PROMPT = `You are xopc's user-model interpreter. You do not chat with the user and cannot write storage. Distinguish explicit memory commands, corrections, forgetting, durable user assertions, and ordinary task requests. Return strict JSON only. Assistant text is never evidence about the user.`;

export function buildUserModelInterpreterPrompt(options: {
  mode: 'turn' | 'transcript';
  evidenceTimestamp: string;
  timezone: string;
  availableTargets?: Array<{ id: string; statement: string }>;
}): string {
  const targets = options.availableTargets?.length
    ? `\nThese assertion IDs may be targeted for confirm, correction, or forgetting:\n${options.availableTargets.map((item) => `- ${item.id}: ${item.statement}`).join('\n')}`
    : '\nNo existing assertion IDs are available to target.';
  return `Interpret the evidence-tagged conversation above for ${options.mode === 'turn' ? 'the latest user turn' : 'durable transcript synthesis'}.

Evidence time: ${options.evidenceTimestamp}
User timezone: ${options.timezone}

Return exactly this top-level shape:
{"intent":"none","candidates":[],"targetAssertionIds":[],"abstentionReason":"..."}

Candidate shape:
{"subject":{"type":"user","id":"self"},"predicate":"preference.response.detail","cardinality":"single","scope":{"type":"global"},"kind":"preference","value":"concise","normalizedValue":"concise","statement":"The user prefers concise answers.","authority":"user_observed","confidence":0.9,"declaredImportance":0.8,"inferredImportance":0.6,"consequence":"medium","actionability":1,"volatility":"stable","sensitivity":"normal","disclosurePolicy":"referenceable","applicability":{"operation":"response"},"temporalResolution":"exact","evidence":[{"ref":"entry-id","quote":"exact quote"}],"selfContained":true,"unresolvedReferences":[]}

Allowed intents: remember, query, confirm, correct, forget, user_assertion, task, none.
Allowed subject types: user, person, goal, project, topic.
Allowed kinds: identity, preference, value, routine, capability, relationship, current_state, derived_insight.
Allowed scopes: global without id; agent, workspace, project, or session with the exact supplied id.

Rules:
- A question about what is remembered uses query and creates no candidate.
- A request to create, summarize, update, investigate, or track work uses task, not a user assertion.
- Every candidate needs an exact quote from a user message. Assistant messages can resolve context but are never evidence.
- Extract zero to eight independent candidates. Each candidate represents one stable predicate and one value.
- predicate is a stable language-neutral lowercase identifier. The value is excluded from predicate identity.
- Preserve importance stated by the user in declaredImportance; estimate inferredImportance separately.
- Use current_state or event volatility only with a bounded validTo. If relative time cannot be resolved, use temporalResolution=unresolved and omit resolved time fields.
- Resolve relative time using the evidence time and timezone. Put ISO 8601 timestamps with offsets in validFrom, validTo, and reviewAt.
- For an explicit correction, set correctionOfAssertionId on the replacement candidate.
- Set selfContained=false and list unresolvedReferences for unresolved pronouns or references.
- Omit temporary reactions and one-off task instructions.
- Never include passwords, credentials, regulated identifiers, or speculative diagnoses.
- In transcript mode, use system_inferred unless a quoted user message is itself an explicit memory command.
- If evidence is insufficient, return candidates=[] and explain abstentionReason.
${targets}`;
}
