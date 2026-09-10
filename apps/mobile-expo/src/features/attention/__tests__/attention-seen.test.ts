import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

vi.mock('../../../storage/mmkv', () => ({
  KEYS: { chatAttentionSeenPrefix: 'chat.attentionSeen:' },
  storage: {
    getString: (key: string) => memory.get(key),
    set: (key: string, value: string | number | boolean) => memory.set(key, String(value)),
    delete: (key: string) => memory.delete(key),
  },
}));

import { markAttentionSeen, readAttentionSeen, unseenAttentionItems } from '../attention-seen';

describe('attention seen state', () => {
  beforeEach(() => memory.clear());

  it('does not resurface unchanged items after dismissal', () => {
    const items = [{ id: 'approval-1', updatedAt: 10 }];
    const seen = markAttentionSeen('gateway-a', items);
    expect(unseenAttentionItems(items, seen)).toEqual([]);
    expect(readAttentionSeen('gateway-a')).toEqual({ 'approval-1': 10 });
  });

  it('resurfaces new or changed items only', () => {
    const seen = markAttentionSeen('gateway-a', [{ id: 'approval-1', updatedAt: 10 }]);
    expect(unseenAttentionItems([
      { id: 'approval-1', updatedAt: 11 },
      { id: 'approval-2', updatedAt: 1 },
    ], seen).map((item) => item.id)).toEqual(['approval-1', 'approval-2']);
  });
});
