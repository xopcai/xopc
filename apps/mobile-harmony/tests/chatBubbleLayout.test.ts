import { describe, expect, it } from 'vitest';

import { userTextBubbleWidth } from '../entry/src/main/ets/common/chatBubbleLayout.ets';

describe('user message bubble width', () => {
  it('keeps voice-only and media minimum widths without forcing short text wide', () => {
    expect(userTextBubbleWidth('', 180)).toBe('180vp');
    expect(userTextBubbleWidth('', 148)).toBe('148vp');
    expect(userTextBubbleWidth('你好', 44)).toBe('62vp');
  });

  it('grows for mixed Chinese and English text without jumping to full width', () => {
    expect(userTextBubbleWidth('xopcflow.cn 这个怎么解释呢', 44)).toBe('248vp');
    expect(userTextBubbleWidth('帮我查找一下今天最新的 AI 新闻，并总结为一篇 XML，然后可以被分享', 180)).toBe('360vp');
  });

  it('measures the longest explicit line and caps long messages', () => {
    expect(userTextBubbleWidth('你好\n世界', 44)).toBe('62vp');
    expect(userTextBubbleWidth('很长的文字'.repeat(20), 44)).toBe('360vp');
  });
});
