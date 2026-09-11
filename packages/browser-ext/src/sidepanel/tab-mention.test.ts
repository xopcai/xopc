import { describe, expect, it } from 'vitest';

import {
  filterMentionableTabs,
  findTabMention,
  removeTabMention,
  type MentionableTab,
} from './tab-mention';

const tabs: MentionableTab[] = [
  { id: 1, title: 'Pull request', url: 'https://github.com/xopcai/xopc/pull/27', hostname: 'github.com', active: false },
  { id: 2, title: 'Documentation', url: 'https://docs.example.com/start', hostname: 'docs.example.com', active: true },
];

describe('tab mention', () => {
  it('finds a mention at the caret after whitespace', () => {
    expect(findTabMention('compare with @git', 17)).toEqual({ start: 13, end: 17, query: 'git' });
    expect(findTabMention('email@example.com', 17)).toBeUndefined();
  });

  it('removes only the selected mention token', () => {
    const value = 'compare @git please';
    expect(removeTabMention(value, { start: 8, end: 12, query: 'git' })).toBe('compare  please');
  });

  it('searches title, hostname, and URL with the active tab first', () => {
    expect(filterMentionableTabs(tabs, '')).toEqual([tabs[1], tabs[0]]);
    expect(filterMentionableTabs(tabs, 'github')).toEqual([tabs[0]]);
    expect(filterMentionableTabs(tabs, 'documentation')).toEqual([tabs[1]]);
  });
});
