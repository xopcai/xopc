import type { ExtensionUserMessageContent } from '../extensions/types/core.js';

export function extensionUserMessageContentToText(content: ExtensionUserMessageContent): string {
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

export function extensionCustomMessageContentToText(content: string | unknown[] | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const record = block as { type?: unknown; text?: unknown };
    if (record.type === 'text' && typeof record.text === 'string') {
      parts.push(record.text);
    }
  }
  return parts.join('');
}

export function extensionCustomMessageToTurnText(message: {
  customType: string;
  content?: string | unknown[];
  details?: unknown;
}): string {
  const type = message.customType.trim();
  const content = extensionCustomMessageContentToText(message.content).trim();
  const details =
    message.details == null
      ? ''
      : typeof message.details === 'string'
        ? message.details.trim()
        : JSON.stringify(message.details, null, 2);
  const sections = [
    `Extension message: ${type}`,
    content ? `Content:\n${content}` : '',
    details ? `Details:\n${details}` : '',
  ].filter(Boolean);
  return sections.join('\n\n');
}
