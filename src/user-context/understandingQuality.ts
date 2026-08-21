import type { MemoryKind } from '../agent/memory/types.js';

const INCOMPLETE_PREFIX = /^(?:and\b|also\b|then\b|plus\b|as\s+well\s+as\b|which\b|that\b|并且|并将|以及|然后|同时|另外|还有|而且|或者|的事项|事项[，,、：:]?)/i;
const DEFERRED_OR_NEGATED_ACTION = /(?:not\s+now|no\s+need\s+to|do\s+not\s+(?:start|proceed)|don't\s+(?:start|proceed)|later\s+maybe|暂时不用|暂时不(?:用|要|开始)?|先不用|无需|不用开始|不要推进|不需要推进)/i;
const ONE_OFF_ACTION_PREFIX = /^(?:please\s+|update\b|investigate\b|summari[sz]e\b|fix\b|write\b|add\b|record\b|track\b)|^(?:请|帮我|更新|调查|汇总|整理|修复|写入|加入|记录|跟进)/i;

function meaningfulLength(content: string): number {
  return content.normalize('NFKC').replace(/[\p{P}\p{S}\s]/gu, '').length;
}

export function isStandaloneUnderstandingContent(content: string): boolean {
  const normalized = content.normalize('NFKC').trim();
  return meaningfulLength(normalized) >= 4
    && !INCOMPLETE_PREFIX.test(normalized)
    && !DEFERRED_OR_NEGATED_ACTION.test(normalized);
}

export function isActionableUnderstandingContent(content: string): boolean {
  return meaningfulLength(content) >= 8 && isStandaloneUnderstandingContent(content);
}

export function isDurableUnderstandingCandidate(kind: MemoryKind, content: string): boolean {
  if (!isStandaloneUnderstandingContent(content)) return false;
  if ((kind === 'commitment' || kind === 'long_term_goal') && ONE_OFF_ACTION_PREFIX.test(content.trim())) {
    return false;
  }
  return true;
}

function comparableText(content: string): string {
  return content
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

function bigrams(content: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index < content.length - 1; index += 1) {
    result.add(content.slice(index, index + 2));
  }
  return result;
}

export function isNearDuplicateUnderstanding(left: string, right: string): boolean {
  const a = comparableText(left);
  const b = comparableText(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length >= 8 && longer.includes(shorter) && shorter.length / longer.length >= 0.55) return true;
  if (shorter.length < 4) return false;
  const aPairs = bigrams(a);
  const bPairs = bigrams(b);
  let overlap = 0;
  for (const pair of aPairs) {
    if (bPairs.has(pair)) overlap += 1;
  }
  return (2 * overlap) / (aPairs.size + bPairs.size) >= 0.78;
}
