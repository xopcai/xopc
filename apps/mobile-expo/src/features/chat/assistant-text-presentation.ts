import type { MessageContent, TextContent } from './messages.types';

const NARRATION_MAX_LENGTH = 160;

export function isAssistantNarration(block: TextContent): boolean {
  return block.presentation === 'pending' || block.presentation === 'narration';
}

/** Keep transient narration useful without letting it become a second answer. */
export function firstNarrationSentence(text: string): string {
  const normalized = text.trim();
  if (!normalized) return '';
  const boundary = normalized.search(/[。！？.!?\n]/);
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

/**
 * Return only the final answer for TTS. Explicit answer segments win; older
 * history without presentation metadata falls back to text after the last
 * thinking/tool block.
 */
export function getAssistantFinalResultText(content: MessageContent[]): string {
  const explicitAnswers = content.filter(
    (block): block is TextContent => block.type === 'text' && block.presentation === 'answer',
  );
  if (explicitAnswers.length > 0) {
    return explicitAnswers.map((block) => block.text).join('\n').trim();
  }

  let lastActivityIndex = -1;
  for (let i = 0; i < content.length; i++) {
    if (content[i].type === 'thinking' || content[i].type === 'tool_use') lastActivityIndex = i;
  }

  const candidates = content.filter(
    (block, index): block is TextContent =>
      index > lastActivityIndex
      && block.type === 'text'
      && !isAssistantNarration(block),
  );
  if (candidates.length > 0) {
    return candidates.map((block) => block.text).join('\n').trim();
  }

  if (lastActivityIndex >= 0) return '';
  return content
    .filter((block): block is TextContent => block.type === 'text' && !isAssistantNarration(block))
    .map((block) => block.text)
    .join('\n')
    .trim();
}
