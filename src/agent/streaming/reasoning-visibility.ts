import type { ReasoningLevel } from '../transcript/thinking-types.js';

export type AgentStreamEvent = { type: string; [key: string]: unknown };

export function applyReasoningVisibility(
  event: AgentStreamEvent,
  reasoningLevel: ReasoningLevel,
): AgentStreamEvent | null {
  if (reasoningLevel !== 'off') return event;
  if (event.type === 'thinking') return null;
  if (
    event.type === 'message_update'
    && (event.assistantMessageEvent as { type?: unknown } | undefined)?.type === 'thinking_delta'
  ) {
    return null;
  }
  if (event.type === 'progress' && event.stage === 'thinking') return null;
  return event;
}
