import type { MessageContent, TextContent } from './messages.types';

export function isAssistantNarration(block: TextContent): boolean {
  return block.presentation === 'narration';
}

/** Classification must not retract text that was already shown while streaming. */
export function assistantTextForDisplay(block: TextContent): string {
  return block.text;
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
      && block.presentation !== 'pending'
      && !isAssistantNarration(block),
  );
  if (candidates.length > 0) {
    return candidates.map((block) => block.text).join('\n').trim();
  }

  if (lastActivityIndex >= 0) return '';
  return content
    .filter((block): block is TextContent => block.type === 'text' && block.presentation !== 'pending'
      && !isAssistantNarration(block))
    .map((block) => block.text)
    .join('\n')
    .trim();
}
