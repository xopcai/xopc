import { describe, expect, it } from 'vitest';

import type { SessionListItem } from '../../../query/sessions';
import { buildSessionListRows } from '../session-time-groups';

const labels = {
  today: 'Today',
  yesterday: 'Yesterday',
  thisWeek: 'This week',
  lastWeek: 'Last week',
  thisMonth: 'This month',
  earlier: 'Earlier',
};

function session(key: string, date: Date): SessionListItem {
  return {
    key,
    status: 'active',
    updatedAt: date.toISOString(),
    messageCount: 1,
  };
}

describe('buildSessionListRows', () => {
  it('groups sessions into day, week, and month buckets', () => {
    const now = new Date(2026, 8, 16, 12);
    const rows = buildSessionListRows([
      session('today', new Date(2026, 8, 16, 9)),
      session('yesterday', new Date(2026, 8, 15, 9)),
      session('this-week', new Date(2026, 8, 14, 9)),
      session('last-week', new Date(2026, 8, 10, 9)),
      session('this-month', new Date(2026, 8, 2, 9)),
      session('older-month', new Date(2026, 7, 20, 9)),
    ], labels, 'en-US', now);

    expect(rows.filter((row) => row.type === 'section').map((row) => row.title)).toEqual([
      'Today',
      'Yesterday',
      'This week',
      'Last week',
      'This month',
      'August 2026',
    ]);
  });

  it('marks the first and last session in each group for card styling', () => {
    const now = new Date(2026, 8, 16, 12);
    const rows = buildSessionListRows([
      session('one', new Date(2026, 8, 16, 10)),
      session('two', new Date(2026, 8, 16, 9)),
    ], labels, 'en-US', now).filter((row) => row.type === 'session');

    expect(rows.map((row) => ({ key: row.session.key, first: row.isFirst, last: row.isLast }))).toEqual([
      { key: 'one', first: true, last: false },
      { key: 'two', first: false, last: true },
    ]);
  });
});
