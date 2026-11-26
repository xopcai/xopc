export const CHAT_SIDEBAR_PAN_TAG: string = 'chat-sidebar-open';
export const CHAT_SIDEBAR_BACK_EDGE: number = 24;
export const CHAT_SIDEBAR_PAN_DISTANCE_VP: number = 10;
// The sidebar pan runs in parallel, so message taps must fail before it can start.
export const CHAT_MESSAGE_TAP_SLOP_VP: number = 8;

export function canStartChatSidebarPan(startX: number, width: number, offsetX: number, offsetY: number): boolean {
  return startX >= CHAT_SIDEBAR_BACK_EDGE && startX <= width - CHAT_SIDEBAR_BACK_EDGE
    && offsetX > Math.abs(offsetY) * 1.25;
}

export function chatSidebarDragProgress(offsetX: number, width: number): number {
  return width > 0 ? Math.min(1, Math.max(0, offsetX / width)) : 0;
}

export function shouldOpenChatSidebar(offsetX: number, velocityX: number, width: number): boolean {
  return width > 0 && (offsetX >= Math.min(width * 0.32, 96) || (offsetX >= 24 && velocityX >= 550));
}
