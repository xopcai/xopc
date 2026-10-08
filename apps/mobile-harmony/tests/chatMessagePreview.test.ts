import { describe, expect, it } from 'vitest';
import { markdownBlocks } from '../entry/src/main/ets/common/markdown';
import { markdownBlockGap, markdownPreviewBlocks, markdownPreviewBlockLines } from '../entry/src/main/ets/common/markdownLayout';
import { ASSISTANT_MESSAGE_PREVIEW_LINES, chatMessageNeedsPreview, chatMessagePreviewLines,
  chatMessagePreviewText, latestChatMessageId, USER_MESSAGE_PREVIEW_LINES } from '../entry/src/main/ets/common/chatMessagePreview';

describe('chat message previews', () => {
  it('does not count artificial blank lines between assistant list items', () => {
    const text = '已创建智能体 小美 ✨\n\n她会：\n\n- 使用中文交流\n\n- 性格温柔、亲切、体贴';
    expect(chatMessageNeedsPreview({ id: 'screenshot', role: 'assistant', text })).toBe(false);
    const blocks = markdownBlocks(text);
    expect(markdownBlockGap(blocks[0])).toBe(0);
    expect(markdownBlockGap(blocks[1], blocks[0])).toBe(8);
    expect(markdownBlockGap(blocks[3], blocks[2])).toBe(3);
  });

  it('preserves markdown structure while sharing a bounded preview line budget', () => {
    const blocks = markdownBlocks('# 标题\n\n**重点**\n\n- 第一项\n- 第二项\n- 第三项');
    const preview = markdownPreviewBlocks(blocks, 4);
    expect(preview.map(block => block.kind)).toEqual(['heading', 'paragraph', 'list', 'list']);
    expect(preview[1].text).toBe('**重点**');
    expect(preview.reduce((sum, _, index) => sum + markdownPreviewBlockLines(preview, index, 4), 0)).toBe(4);
    expect(markdownPreviewBlocks(markdownBlocks('很长的内容'.repeat(100)), 8)).toHaveLength(1);
    const long = markdownPreviewBlocks(markdownBlocks('很长的内容'.repeat(100)), 8);
    expect(markdownPreviewBlockLines(long, 0, 8)).toBe(8);
  });
  it('uses a tighter limit for user messages than historical assistant responses', () => {
    expect(USER_MESSAGE_PREVIEW_LINES).toBe(6);
    expect(ASSISTANT_MESSAGE_PREVIEW_LINES).toBe(12);
    expect(chatMessagePreviewLines({ id: 'u', role: 'user', text: 'hello' })).toBe(6);
    expect(chatMessagePreviewLines({ id: 'a', role: 'assistant', text: 'hello' })).toBe(12);
  });

  it('only sends content that exceeds the line budget to the details sheet', () => {
    expect(chatMessageNeedsPreview({ id: 'short', role: 'user', text: 'Short question' })).toBe(false);
    expect(chatMessageNeedsPreview({ id: 'long', role: 'user', text: '这是一条很长的用户消息。'.repeat(8) })).toBe(true);
    expect(chatMessageNeedsPreview({ id: 'answer', role: 'assistant', text: 'A detailed answer. '.repeat(30) })).toBe(true);
  });

  it('turns markdown into a readable plain-text card preview', () => {
    expect(chatMessagePreviewText({ id: 'markdown', role: 'assistant', text: '# Summary\n\n**Useful** detail' }))
      .toBe('Summary\n\nUseful detail');
  });

  it('finds the latest user or assistant message and ignores non-message rows', () => {
    expect(latestChatMessageId([
      { id: 'assistant', role: 'assistant', text: 'answer' },
      { id: 'system', role: 'system', text: 'event' },
      { id: 'user', role: 'user', text: 'follow-up' },
      { id: 'context', role: 'context', text: 'metadata' },
    ])).toBe('user');
    expect(latestChatMessageId([])).toBe('');
  });
});
