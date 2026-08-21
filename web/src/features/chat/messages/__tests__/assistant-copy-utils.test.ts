// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  getAssistantCopyMarkdown,
  getAssistantCopyPlainText,
} from '@/features/chat/messages/assistant-copy-utils';

describe('assistant copy presentation', () => {
  const content = [
    { type: 'text' as const, text: '我先检查项目。后续过程不展示。', presentation: 'narration' as const },
    { type: 'text' as const, text: 'I will now repeat the plan.', presentation: 'narration' as const },
    { type: 'text' as const, text: '**最终结果**', presentation: 'answer' as const },
  ];

  it('copies the same narration boundary that the user sees', () => {
    expect(getAssistantCopyMarkdown(content)).toBe('我先检查项目。\n\n**最终结果**');
    expect(getAssistantCopyPlainText(content)).toBe('我先检查项目。\n\n最终结果');
  });
});
