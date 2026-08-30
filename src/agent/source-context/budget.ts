import type { AgentSourceContext } from './types.js';

export const MAX_TURN_CONTEXT_TOKENS = 32_000;

const CHARS_PER_TOKEN_ESTIMATE = 4;
const TRUNCATION_MARKER = '\n\n[context truncated]';

export function fitSourceContextsToBudget(
  contexts: readonly AgentSourceContext[],
  maxTokens = MAX_TURN_CONTEXT_TOKENS,
): AgentSourceContext[] {
  let remainingChars = Math.max(0, maxTokens) * CHARS_PER_TOKEN_ESTIMATE;
  return contexts.map((context, index) => {
    const remainingItems = contexts.length - index;
    const quota = Math.floor(remainingChars / remainingItems);
    const text = context.text.length <= quota
      ? context.text
      : quota <= TRUNCATION_MARKER.length
        ? TRUNCATION_MARKER.slice(0, quota)
        : `${context.text.slice(0, quota - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
    remainingChars = Math.max(0, remainingChars - text.length);
    return {
      ...context,
      text,
      tokenEstimate: Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE),
      truncated: context.truncated === true || text.length < context.text.length,
    };
  });
}
