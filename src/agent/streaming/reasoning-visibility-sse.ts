/**
 * Outbound SSE visibility for session `reasoningLevel`.
 * Single choke point: call from the queue push path so agent subscribe stays free of policy branches.
 *
 * Note: Does not alter persisted messages or agent state; history/UI may still strip thinking separately.
 */

import type { ReasoningLevel } from '../transcript/thinking-types.js';

export type SseStreamEvent = { type: string; [key: string]: unknown };

/**
 * @returns `null` to drop the event; unchanged `event` otherwise.
 */
export function applyReasoningVisibilityToSseEvent(
  event: SseStreamEvent,
  reasoningLevel: ReasoningLevel,
): SseStreamEvent | null {
  if (reasoningLevel !== 'off') {
    return event;
  }
  if (event.type === 'thinking') {
    return null;
  }
  if (event.type === 'progress' && event.stage === 'thinking') {
    return null;
  }
  return event;
}
