import { describe, expect, it } from 'vitest';
import { chatReplySpaceBudget, consumeChatReplySpace } from '../entry/src/main/ets/common/chatReplySpace.ets';

describe('chat reply space', () => {
  it('uses the visible viewport above the composer and safe clearance', () => {
    expect(chatReplySpaceBudget(720, 120)).toBe(270);
    expect(chatReplySpaceBudget(1600, 120)).toBe(320);
    expect(chatReplySpaceBudget(320, 120)).toBe(90);
    expect(chatReplySpaceBudget(80, 120)).toBe(0);
  });

  it('consumes blank space before content needs to move and retains it for short replies', () => {
    const remaining = consumeChatReplySpace(60, 60, 20, 60, true);
    expect(remaining).toBe(40);
    expect(consumeChatReplySpace(60, remaining, 20, 60, true)).toBe(40);
    expect(consumeChatReplySpace(60, remaining, 10, 60, true)).toBe(40);
    expect(consumeChatReplySpace(60, remaining, 240, 60, true)).toBe(0);
  });

  it('freezes history readers and caps the space after the keyboard shrinks the viewport', () => {
    expect(consumeChatReplySpace(60, 40, 240, 30, false)).toBe(40);
    expect(consumeChatReplySpace(60, 40, 20, 30, true)).toBe(10);
    expect(consumeChatReplySpace(60, 10, 10, 60, true)).toBe(10);
  });
});
