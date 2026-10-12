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

  it('copies only the final answer', () => {
    expect(getAssistantCopyMarkdown(content)).toBe('**最终结果**');
    expect(getAssistantCopyPlainText(content)).toBe('最终结果');
  });
  it('copies visible Personal conversation text without thoughts or tool details', () => {
    const visible = [...content, { type: 'thinking' as const, text: 'private thought' }];
    expect(getAssistantCopyMarkdown(visible, true)).toBe(content.map(block => block.text).join('\n\n'));
    expect(getAssistantCopyPlainText(visible, true)).not.toContain('private thought');
  });
});
