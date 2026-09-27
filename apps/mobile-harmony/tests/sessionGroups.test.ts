import { describe, expect, it } from 'vitest';

import { groupChatSessions, sessionAge } from '../entry/src/main/ets/common/sessionGroups.ets';

const item = (key: string, updatedAt = '2026-09-17T10:00:00') => ({ key, updatedAt, messageCount: 1 });

describe('conversation grouping', () => {
  it('uses mobile relative-time boundaries and tolerates invalid or future timestamps', () => {
    const now = Date.parse('2026-09-17T12:00:00Z');
    for (const [minutes, unit, count] of [[-1, 'now', 0], [0, 'now', 0], [59, 'minute', 59], [60, 'hour', 1],
      [1440, 'day', 1], [10080, 'week', 1], [50400, 'date', 5]] as const) {
      expect(sessionAge(new Date(now - minutes * 60000).toISOString(), now)).toEqual({ unit, count });
    }
    expect(sessionAge('bad', now).unit).toBe('invalid');
  });

  it('matches mobile calendar groups, including Monday boundaries and invalid dates', () => {
    const rows = [item('today'), item('yesterday', '2026-09-16'), item('week', '2026-09-14'),
      item('last', '2026-09-07'), item('month', '2026-09-01'), item('old', '2026-08-01'), item('bad', 'bad')];
    expect(groupChatSessions(rows, new Date('2026-09-17T12:00:00')).map(group => group.id))
      .toEqual(['today', 'yesterday', 'this_week', 'last_week', 'this_month', '2026-08', 'earlier']);
  });
});
