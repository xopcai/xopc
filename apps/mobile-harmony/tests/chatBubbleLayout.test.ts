import { describe, expect, it } from 'vitest';

import { chatPlainAssistantBubbleText, chatTextBubbleWidth } from '../entry/src/main/ets/common/chatBubbleLayout.ets';

describe('user message bubble width', () => {
  it('keeps voice-only and media minimum widths without forcing short text wide', () => {
    expect(chatTextBubbleWidth('', 180)).toBe('180vp');
    expect(chatTextBubbleWidth('', 148)).toBe('148vp');
    expect(chatTextBubbleWidth('你好', 44)).toBe('62vp');
  });

  it('grows for mixed Chinese and English text without jumping to full width', () => {
    expect(chatTextBubbleWidth('xopcflow.cn 这个怎么解释呢', 44)).toBe('248vp');
    expect(chatTextBubbleWidth('帮我查找一下今天最新的 AI 新闻，并总结为一篇 XML，然后可以被分享', 180)).toBe('360vp');
  });

  it('measures the longest explicit line and caps long messages', () => {
    expect(chatTextBubbleWidth('你好\n世界', 44)).toBe('62vp');
    expect(chatTextBubbleWidth('很长的文字'.repeat(20), 44)).toBe('360vp');
  });
});

describe('assistant message bubble width', () => {
  const reply = { id: 'reply', role: 'assistant', text: 'OK' };

  it('measures only the confirmed text, including during reveal', () => {
    expect(chatPlainAssistantBubbleText({ ...reply, live: true, blocks: [
      { id: 'progress', kind: 'text', text: 'Long intermediate text', presentation: 'narration' },
      { id: 'answer', kind: 'text', text: 'OK', presentation: 'answer' },
    ] })).toBe('OK');
  });

  it('reserves the reading width for structured Markdown and attachments', () => {
    expect(chatPlainAssistantBubbleText({ ...reply, text: '```sh\necho OK\n```' })).toBe('');
    expect(chatPlainAssistantBubbleText({ ...reply, text: '1. Item' })).toBe('');
    expect(chatPlainAssistantBubbleText({ ...reply, refs: [{ kind: 'note', sourceId: 'note', expectedVersion: '1' }] })).toBe('');
  });

  it('reserves the reading width for a project comparison during and after streaming', () => {
    const deliveries = [{ version: 2, operation: 'opened', projectComparison: { surfaceId: 'comparison_test', messages: [] } }];
    expect(chatPlainAssistantBubbleText({ ...reply, deliveries, live: true })).toBe('');
    expect(chatPlainAssistantBubbleText({ ...reply, deliveries })).toBe('');
  });
});
