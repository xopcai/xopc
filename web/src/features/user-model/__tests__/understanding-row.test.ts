import { describe, expect, it } from 'vitest';

import type { UserAssertion } from '../user-model-api';
import { groupUnderstandingByDate } from '../understanding-row.utils';

const item = (id: string, recordedAt: number) => ({ id, recordedAt } as UserAssertion);

describe('groupUnderstandingByDate', () => {
  it('groups around local calendar midnight and sorts newest first', () => {
    const now = new Date(2026, 8, 20, 0, 5);
    const groups = groupUnderstandingByDate([
      item('older', new Date(2026, 8, 18, 23).getTime()),
      item('yesterday', new Date(2026, 8, 19, 23, 59).getTime()),
      item('today', new Date(2026, 8, 20, 0, 1).getTime()),
    ], 'zh', now);
    expect(groups.map((group) => group.label)).toEqual(['今天', '昨天', '2026年9月18日']);
    expect(groups.flatMap((group) => group.items.map((entry) => entry.id))).toEqual(['today', 'yesterday', 'older']);
  });

  it('preserves separate records and does not reorder the input', () => {
    const now = new Date(2026, 8, 20, 12);
    const items = [item('first', now.getTime() - 1000), item('second', now.getTime())];
    expect(groupUnderstandingByDate(items, 'en', now)[0]).toEqual({ label: 'Today', items: [items[1], items[0]] });
    expect(items.map((entry) => entry.id)).toEqual(['first', 'second']);
  });
});
