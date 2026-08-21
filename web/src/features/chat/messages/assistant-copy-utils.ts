// Build clipboard payloads for the assistant message "Copy" actions.
// Thinking/tool_use blocks are skipped (the user wants the visible answer);
// images render as `[image]` placeholders. Two flavors:
//   - markdown source (raw `b.text` joined)
//   - plain text (markdown rendered → DOM → textContent)

import { marked } from 'marked';

import type { MessageContent } from '@/features/chat/messages/messages.types';
import {
  assistantTextForDisplay,
  isAssistantNarration,
} from '@/features/chat/messages/assistant-text-presentation';

/** Markdown source for clipboard: visible text blocks + `[image]` placeholders; skips thinking/tools. */
export function getAssistantCopyMarkdown(content: MessageContent[]): string {
  const parts: string[] = [];
  let narrationIncluded = false;
  for (const b of content) {
    if (b.type === 'thinking' || b.type === 'tool_use') continue;
    if (b.type === 'text') {
      if (isAssistantNarration(b)) {
        if (narrationIncluded) continue;
        narrationIncluded = true;
      }
      parts.push(assistantTextForDisplay(b));
    } else if (b.type === 'image') {
      parts.push('[image]');
    }
  }
  return parts.join('\n\n').trim();
}

function markdownToPlainText(md: string): string {
  if (!md.trim()) return '';
  const html = marked.parse(md, { gfm: true, breaks: false }) as string;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return doc.body.textContent?.trim() ?? '';
}

/** Plain text for clipboard: rendered text per block + `[image]` placeholders. */
export function getAssistantCopyPlainText(content: MessageContent[]): string {
  const parts: string[] = [];
  let narrationIncluded = false;
  for (const b of content) {
    if (b.type === 'thinking' || b.type === 'tool_use') continue;
    if (b.type === 'text') {
      if (isAssistantNarration(b)) {
        if (narrationIncluded) continue;
        narrationIncluded = true;
      }
      parts.push(markdownToPlainText(assistantTextForDisplay(b)));
    } else if (b.type === 'image') {
      parts.push('[image]');
    }
  }
  return parts.join('\n\n').trim();
}
