import type { TextContent } from '@/features/chat/messages/messages.types';

const NARRATION_MAX_LENGTH = 160;

export function isAssistantNarration(block: TextContent): boolean {
  return block.presentation === 'pending' || block.presentation === 'narration';
}

/** Keep transient model narration useful without letting it become a second answer. */
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
