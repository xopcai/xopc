// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { chatVirtualScroll, registerChatVirtualScroll } from '@/features/chat/scroll/chat-virtual-scroll';

describe('virtual scroll ownership', () => {
  it('isolates containers and prevents stale cleanup from removing a newer owner', () => {
    const root = document.createElement('div');
    const other = document.createElement('div');
    const first = { reveal: vi.fn(() => true), end: vi.fn() };
    const latest = { reveal: vi.fn(() => true), end: vi.fn() };
    const disposeFirst = registerChatVirtualScroll(root, first);
    const disposeLatest = registerChatVirtualScroll(root, latest);
    disposeFirst();
    expect(chatVirtualScroll(root)).toBe(latest);
    expect(chatVirtualScroll(other)).toBeUndefined();
    chatVirtualScroll(root)?.reveal(42);
    expect(latest.reveal).toHaveBeenCalledWith(42);
    disposeLatest();
    expect(chatVirtualScroll(root)).toBeUndefined();
  });
});
