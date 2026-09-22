import { describe, expect, it } from 'vitest';

import {
  formatChatMessageTime,
  formatChatTimeSeparator,
  shouldShowChatTimeSeparator,
} from '@/features/chat/messages/message-time';

describe('chat message time', () => {
  it('groups nearby messages and separates long gaps or new days', () => {
    const start = new Date(2026, 8, 22, 10, 0).getTime();
    expect(shouldShowChatTimeSeparator(start, undefined)).toBe(true);
    expect(shouldShowChatTimeSeparator(start + 29 * 60_000, start)).toBe(false);
    expect(shouldShowChatTimeSeparator(start + 30 * 60_000, start)).toBe(true);
    expect(shouldShowChatTimeSeparator(new Date(2026, 8, 23, 0, 1).getTime(), start)).toBe(true);
  });

  it('uses relative day labels without exposing seconds', () => {
    const now = new Date(2026, 8, 22, 12, 0).getTime();
    const today = new Date(2026, 8, 22, 10, 48).getTime();
    const yesterday = new Date(2026, 8, 21, 22, 10).getTime();

    expect(formatChatTimeSeparator(today, now, 'zh')).toContain('今天');
    expect(formatChatTimeSeparator(yesterday, now, 'en')).toContain('Yesterday');
    expect(formatChatMessageTime(today).match(/:/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
});
