import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { estimateMessageTokens, estimateTextTokens } from '../memory/context-budget.js';

/** Ephemeral request projection; complete user turns and current tool execution stay intact. */
export function projectVoiceHistory<T extends { role: string; timestamp?: number }>(
  messages: readonly T[], historyTokens: number, currentUserTimestamp?: number,
): { messages: T[]; omittedMessages: number } {
  const userIndexes = messages.flatMap((message, index) => message.role === 'user' ? [index] : []);
  if (!userIndexes.length) return { messages: [...messages], omittedMessages: 0 };
  const currentIndex = currentUserTimestamp === undefined ? undefined
    : userIndexes.find(index => messages[index].timestamp === currentUserTimestamp);
  const protectedFrom = currentIndex ?? userIndexes.at(-1)!;
  let start = protectedFrom;
  const cost = (message: T) => message.role === 'system' ? 0
    : message.role === 'compactionSummary' || message.role === 'branchSummary'
      ? estimateTextTokens(JSON.stringify(message)) + 12
      : estimateMessageTokens(message as unknown as AgentMessage);
  let used = messages.slice(start).reduce((sum, message) => sum + cost(message), 0);
  for (let i = userIndexes.indexOf(protectedFrom) - 1; i >= 0; i--) {
    const candidate = userIndexes[i];
    const tokens = messages.slice(candidate, start).reduce((sum, message) => sum + cost(message), 0);
    if (used + tokens > historyTokens) break;
    start = candidate;
    used += tokens;
  }
  if (used + messages.slice(0, start).reduce((sum, message) => sum + cost(message), 0) <= historyTokens) {
    return { messages: [...messages], omittedMessages: 0 };
  }
  const summary = messages.slice(0, start).findLast(message => message.role === 'compactionSummary' || message.role === 'branchSummary');
  const retainSummary = summary && used + cost(summary) <= historyTokens;
  const projected = messages.filter((message, index) => index >= start || message.role === 'system' || (retainSummary && message === summary));
  return { messages: projected, omittedMessages: messages.length - projected.length };
}

export const voiceHistoryNotice = 'This live voice request includes recent complete turns and the entire current execution. Earlier conversation is still stored, but is not all in this request. Use the available conversation recall/search tools for missing past details. Do not guess earlier facts or treat omitted history as deleted.';
