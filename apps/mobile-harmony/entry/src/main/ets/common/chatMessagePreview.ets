import { XopcChatRow } from '../model/chat';
import { markdownBlocks, markdownSpans, XopcMarkdownBlock, XopcMarkdownSpan } from './markdown';
import { chatAnswerText } from './chatRichContent';

export const USER_MESSAGE_PREVIEW_LINES: number = 4;
export const ASSISTANT_MESSAGE_PREVIEW_LINES: number = 8;

export function latestChatMessageId(rows: XopcChatRow[]): string {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    if (row.role === 'user' || row.role === 'assistant') return row.id;
  }
  return '';
}

export function chatMessagePreviewText(row: XopcChatRow): string {
  const source = row.role === 'assistant' ? chatAnswerText(row) : row.text;
  if (!source) return '';
  return markdownBlocks(source)
    .filter((block: XopcMarkdownBlock): boolean => block.kind !== 'image' && block.kind !== 'rule')
    .map((block: XopcMarkdownBlock): string => markdownSpans(block.text)
      .map((span: XopcMarkdownSpan): string => span.text).join(''))
    .filter((text: string): boolean => !!text)
    .join('\n\n').trim();
}

export function chatMessagePreviewLines(row: XopcChatRow): number {
  return row.role === 'user' ? USER_MESSAGE_PREVIEW_LINES : ASSISTANT_MESSAGE_PREVIEW_LINES;
}

export function chatMessageNeedsPreview(row: XopcChatRow): boolean {
  const text = chatMessagePreviewText(row);
  if (!text) return false;
  const maximumLines = chatMessagePreviewLines(row);
  let lines = 1;
  let lineUnits = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 10) {
      lines++;
      lineUnits = 0;
      continue;
    }
    lineUnits += code > 255 ? 1 : 0.55;
    if (lineUnits >= 15) {
      lines++;
      lineUnits = 0;
    }
    if (lines > maximumLines) return true;
  }
  return false;
}
