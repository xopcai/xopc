import type { TextContent } from '@/features/chat/messages/messages.types';

const NARRATION_MAX_LENGTH = 160;

function isEscaped(text: string, index: number): boolean {
  let precedingBackslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    precedingBackslashes += 1;
  }
  return precedingBackslashes % 2 === 1;
}

function findNarrationSentenceBoundary(text: string): number {
  let codeDelimiterLength = 0;

  for (let cursor = 0; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (char === '`' && !isEscaped(text, cursor)) {
      let runEnd = cursor + 1;
      while (text[runEnd] === '`') runEnd += 1;
      const runLength = runEnd - cursor;
      if (codeDelimiterLength === 0) codeDelimiterLength = runLength;
      else if (codeDelimiterLength === runLength) codeDelimiterLength = 0;
      cursor = runEnd - 1;
      continue;
    }

    if (codeDelimiterLength > 0 || isEscaped(text, cursor)) continue;
    if (char === '\n' || char === '。' || char === '！' || char === '？' || char === '!' || char === '?') {
      return cursor;
    }
    if (char === '.') {
      const next = text[cursor + 1];
      if (next === undefined || /[\s"')\]}\u2019\u201d]/u.test(next)) return cursor;
    }
  }

  return -1;
}

export function isAssistantNarration(block: TextContent): boolean {
  return block.presentation === 'pending' || block.presentation === 'narration';
}

/** Keep transient model narration useful without letting it become a second answer. */
export function firstNarrationSentence(text: string): string {
  const normalized = text.trim();
  if (!normalized) return '';
  const boundary = findNarrationSentenceBoundary(normalized);
  if (boundary >= 0 && boundary < NARRATION_MAX_LENGTH) {
    const char = normalized[boundary];
    return normalized.slice(0, boundary + (char === '\n' ? 0 : 1)).trim();
  }
  if (normalized.length <= NARRATION_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, NARRATION_MAX_LENGTH).trimEnd()}…`;
}

export function assistantTextForDisplay(block: TextContent): string {
  return isAssistantNarration(block) ? firstNarrationSentence(block.text) : block.text;
}
