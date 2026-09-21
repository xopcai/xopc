// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { collectChatFindMatches } from '@/features/chat/find/chat-find-dom';

describe('collectChatFindMatches', () => {
  it('finds case-insensitive text across inline nodes and ignores controls', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <article data-chat-message-index="3">
        <div data-chat-find-text>Hello <strong>Wo</strong>rld hello</div>
        <button>Hello</button>
      </article>
    `;

    const matches = collectChatFindMatches(root, 'hello');

    expect(matches).toHaveLength(2);
    expect(matches.map((match) => match.messageIndex)).toEqual([3, 3]);
    expect(matches.map((match) => match.occurrence)).toEqual([0, 1]);
    expect(matches.map((match) => match.range.toString())).toEqual(['Hello', 'hello']);
    expect(collectChatFindMatches(root, 'world')[0]?.range.toString()).toBe('World');
  });

  it('returns no matches for blank queries or excluded text', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <article data-chat-message-index="0">
        <div data-chat-find-text><span aria-hidden="true">secret</span></div>
      </article>
    `;

    expect(collectChatFindMatches(root, ' ')).toEqual([]);
    expect(collectChatFindMatches(root, 'secret')).toEqual([]);
  });
});
