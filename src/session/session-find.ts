import { markdownToIR } from '../markdown/ir.js';

type FindableMessage = {
  role: string;
  content: string | unknown[];
  displayIndex?: number;
};

export type SessionFindMatch = {
  displayIndex: number;
  occurrence: number;
};

export type SessionFindResult = {
  query: string;
  total: number;
  truncated: boolean;
  matches: SessionFindMatch[];
};

function searchableMessageText(message: FindableMessage): string {
  if (message.role !== 'user' && message.role !== 'assistant') return '';
  if (typeof message.content === 'string') return markdownToIR(message.content, { tableMode: 'bullets' }).text;
  return message.content.flatMap((block) => {
    if (!block || typeof block !== 'object') return [];
    const value = block as { type?: unknown; text?: unknown; presentation?: unknown };
    return value.type === 'text'
      && value.presentation !== 'pending'
      && value.presentation !== 'narration'
      && typeof value.text === 'string'
      ? [markdownToIR(value.text, { tableMode: 'bullets' }).text]
      : [];
  }).join('\n');
}

function countLiteralMatches(text: string, query: string): number {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let count = 0;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    count += 1;
    from = index + needle.length;
  }
  return count;
}

export function findSessionMessages(
  messages: readonly FindableMessage[],
  rawQuery: string,
  limit = 1_000,
): SessionFindResult {
  const query = rawQuery.trim();
  const cappedLimit = Math.min(1_000, Math.max(1, Math.trunc(limit)));
  if (!query) return { query, total: 0, truncated: false, matches: [] };
  const matches: SessionFindMatch[] = [];
  const occurrencesByDisplayIndex = new Map<number, number>();
  let total = 0;
  messages.forEach((message, messageIndex) => {
    const displayIndex = Number.isInteger(message.displayIndex) && message.displayIndex! >= 0
      ? message.displayIndex!
      : messageIndex;
    const count = countLiteralMatches(searchableMessageText(message), query);
    const occurrenceOffset = occurrencesByDisplayIndex.get(displayIndex) ?? 0;
    total += count;
    for (let occurrence = 0; occurrence < count && matches.length < cappedLimit; occurrence += 1) {
      matches.push({ displayIndex, occurrence: occurrenceOffset + occurrence });
    }
    occurrencesByDisplayIndex.set(displayIndex, occurrenceOffset + count);
  });
  return { query, total, truncated: total > matches.length, matches };
}
