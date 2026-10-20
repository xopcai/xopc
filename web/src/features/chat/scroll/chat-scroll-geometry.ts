/**
 * Cursor / VS Code chat–style scroll geometry.
 * One threshold: near-bottom = auto-follow the transcript tail.
 */
export const CHAT_SCROLL_NEAR_BOTTOM_PX = 96;

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
  if (Math.abs(chatScrollDistanceFromBottom(el)) > 0.5) el.scrollTop = el.scrollHeight;
}

/** Locate the reading anchor with logarithmic layout reads, even in long threads. */
export function chatTimelineAnchorIndex(root: HTMLElement): number {
  const rows = root.querySelectorAll<HTMLElement>('[data-chat-message-index]');
  if (!rows.length) return 0;
  const rect = root.getBoundingClientRect();
  const anchorY = rect.top + Math.min(180, rect.height * 0.35);
  let low = 0;
  let high = rows.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (rows[mid].getBoundingClientRect().top <= anchorY) low = mid;
    else high = mid - 1;
  }
  const index = Number.parseInt(rows[low].dataset.chatMessageIndex ?? '', 10);
  return Number.isFinite(index) ? index : 0;
}

export function chatScrollBehavior(): ScrollBehavior {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}
