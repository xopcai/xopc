import { describe, expect, it } from 'vitest';

import { formatDateGroup, formatRelativeTime, type NoteTimeLabels } from '../note-time';

const zhLabels: NoteTimeLabels = {
  justNow: '刚刚',
  minutesAgo: '{{n}}分钟前',
  today: '今天',
  yesterday: '昨天',
  daysAgo: '{{n}}天前',
  locale: 'zh-CN',
};

describe('note time formatting', () => {
  it('formats date group headings with the selected app locale', () => {
    const now = new Date(2026, 8, 4, 12).getTime();

    expect(formatDateGroup(new Date(2026, 7, 31, 12).getTime(), now, zhLabels)).toBe('8月31日');
    expect(formatDateGroup(new Date(1970, 0, 1, 12).getTime(), now, zhLabels)).toBe('1970年1月1日');
  });

  it('formats older note-card dates with the selected app locale', () => {
    const now = new Date(2026, 8, 4, 12).getTime();

    expect(formatRelativeTime(new Date(2026, 7, 20, 12).getTime(), now, zhLabels)).toBe('8月20日');
  });
});
