import type { Message } from '@/features/chat/messages.types';

const CHARS_PER_TOKEN_HEURISTIC = 4;

export function roughTokensFromChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / CHARS_PER_TOKEN_HEURISTIC);
}

function usageTurnTokens(u: NonNullable<Message['usage']>): number | null {
  if (u.inputTokens != null || u.outputTokens != null) {
    return (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
  }
  if (u.totalTokens != null) return u.totalTokens;
  return null;
}

function heuristicMessageTokens(m: Message): number {
  let chars = 0;
  for (const c of m.content) {
    if (c.type === 'text') chars += c.text.length;
    else if (c.type === 'thinking') chars += c.text.length;
    else if (c.type === 'tool_use') {
      chars += JSON.stringify(c.input ?? '').length;
      if (c.result != null) chars += typeof c.result === 'string' ? c.result.length : JSON.stringify(c.result).length;
    }
  }
  if (m.attachments?.length) {
    for (const a of m.attachments) {
      chars += (a.extractedText?.length ?? 0) + (a.name?.length ?? 0);
    }
  }
  return roughTokensFromChars(chars);
}

/**
 * Rough token count for the next model call: prefers the last completed assistant
 * `usage` row (input+output), then adds heuristic tokens for messages after that
 * turn plus optional composer draft characters.
 */
export function estimateConversationContextTokens(
  messages: readonly Message[],
  draftChars = 0,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant' || !m.usage) continue;
    const turn = usageTurnTokens(m.usage);
    if (turn == null || turn <= 0) continue;
    let trailing = 0;
    for (let j = i + 1; j < messages.length; j++) {
      trailing += heuristicMessageTokens(messages[j]);
    }
    return turn + trailing + roughTokensFromChars(draftChars);
  }
  let all = 0;
  for (const m of messages) {
    all += heuristicMessageTokens(m);
  }
  return all + roughTokensFromChars(draftChars);
}
