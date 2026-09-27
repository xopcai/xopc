import { describe, expect, it } from 'vitest';
import { ASSISTANT_MESSAGE_PREVIEW_LINES, chatMessageNeedsPreview, chatMessagePreviewLines,
  chatMessagePreviewText, latestChatMessageId, USER_MESSAGE_PREVIEW_LINES } from '../entry/src/main/ets/common/chatMessagePreview';

describe('chat message previews', () => {
  it('uses a tighter limit for user messages than historical assistant responses', () => {
    expect(USER_MESSAGE_PREVIEW_LINES).toBe(4);
    expect(ASSISTANT_MESSAGE_PREVIEW_LINES).toBe(8);
    expect(chatMessagePreviewLines({ id: 'u', role: 'user', text: 'hello' })).toBe(4);
    expect(chatMessagePreviewLines({ id: 'a', role: 'assistant', text: 'hello' })).toBe(8);
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
