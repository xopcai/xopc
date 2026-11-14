import { describe, expect, it } from 'vitest';
import { canStartChatSidebarPan, chatSidebarDragProgress, shouldOpenChatSidebar } from '../entry/src/main/ets/common/chatSidebarGesture.ets';

describe('chat sidebar swipe', () => {
  it('reserves both system back edges and requires a horizontal rightward movement', () => {
    expect(canStartChatSidebarPan(8, 375, 48, 0)).toBe(false);
    expect(canStartChatSidebarPan(368, 375, 48, 0)).toBe(false);
    expect(canStartChatSidebarPan(110, 375, 12, 70)).toBe(false);
    expect(canStartChatSidebarPan(110, 375, 36, 35)).toBe(false);
    expect(canStartChatSidebarPan(110, 375, -48, 0)).toBe(false);
    expect(canStartChatSidebarPan(110, 375, 48, 20)).toBe(true);
  });

  it('follows the finger within the drawer width', () => {
    expect(chatSidebarDragProgress(75, 300)).toBe(0.25);
    expect(chatSidebarDragProgress(-5, 300)).toBe(0);
    expect(chatSidebarDragProgress(400, 300)).toBe(1);
    expect(chatSidebarDragProgress(30, 0)).toBe(0);
  });

  it('settles open after a deliberate drag or quick flick', () => {
    expect(shouldOpenChatSidebar(100, 0, 300)).toBe(true);
    expect(shouldOpenChatSidebar(25, 600, 300)).toBe(true);
    expect(shouldOpenChatSidebar(18, 600, 300)).toBe(false);
    expect(shouldOpenChatSidebar(65, 200, 300)).toBe(false);
    expect(shouldOpenChatSidebar(0, -800, 300)).toBe(false);
  });
});
