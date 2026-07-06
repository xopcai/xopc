/** Pixels from scroll bottom: past this, viewport is treated as "reading history". */
export const CHAT_LIST_UNPIN_BEYOND_PX = 48;
/** When unpinned, re-pin only when this close to the bottom again (hysteresis). */
export const CHAT_LIST_REPIN_WITHIN_PX = 24;

export function chatListDistanceFromBottom(
  offsetY: number,
  contentHeight: number,
  viewportHeight: number,
): number {
  return contentHeight - offsetY - viewportHeight;
}

/** Update pin state with hysteresis to avoid boundary flicker. */
export function applyPinHysteresis(wasPinned: boolean, distanceFromBottom: number): boolean {
  if (wasPinned) {
    return distanceFromBottom <= CHAT_LIST_UNPIN_BEYOND_PX;
  }
  return distanceFromBottom < CHAT_LIST_REPIN_WITHIN_PX;
}

/** User scrolled toward older messages (offset dropped) without content shrinking. */
export function isUserScrollTowardHistory(
  offsetY: number,
  prevOffsetY: number,
  contentHeight: number,
  prevContentHeight: number,
): boolean {
  if (offsetY >= prevOffsetY - 1.5) return false;
  const contentShrunk = contentHeight < prevContentHeight - 1;
  return !contentShrunk;
}
