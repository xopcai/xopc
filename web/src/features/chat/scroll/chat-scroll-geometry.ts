/**
 * Cursor / VS Code chat–style scroll geometry.
 * One threshold: near-bottom = auto-follow the transcript tail.
 */
export const CHAT_SCROLL_NEAR_BOTTOM_PX = 48;

export function chatScrollDistanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

/** True when the viewport is close enough to the tail to keep auto-following. */
export function isNearChatBottom(
  el: HTMLElement,
  thresholdPx = CHAT_SCROLL_NEAR_BOTTOM_PX,
): boolean {
  return chatScrollDistanceFromBottom(el) <= thresholdPx;
}

/** Scroll container to the transcript tail (instant, no animation). */
export function scrollChatToEnd(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight;
}
