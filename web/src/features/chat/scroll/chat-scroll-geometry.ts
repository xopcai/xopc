/** Pixels from scroll bottom: past this, viewport is treated as "reading history" (must match list stick guard). */
export const CHAT_SCROLL_UNPIN_BEYOND_PX = 4;
/** When unpinned, re-pin only when this close to the bottom again (hysteresis: keep < UNPIN). */
export const CHAT_SCROLL_REPIN_WITHIN_PX = 2;
/** `scrollTop` drop larger than this counts as an upward user gesture (not shrink clamp). */
export const CHAT_SCROLL_USER_UPWARD_EPS = 1.5;

export function chatScrollDistanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

/** True when the viewport is aligned with the transcript tail (auto-scroll allowed). */
export function isChatScrollPinnedToBottom(el: HTMLElement): boolean {
  return chatScrollDistanceFromBottom(el) <= CHAT_SCROLL_UNPIN_BEYOND_PX;
}

/** True when the user scrolled back close enough to resume tail follow. */
export function isChatScrollNearBottomForRepin(el: HTMLElement): boolean {
  return chatScrollDistanceFromBottom(el) < CHAT_SCROLL_REPIN_WITHIN_PX;
}

/**
 * Whether a pinned viewport should follow transcript growth on the next scroll pass.
 * Content growing below the viewport (first message, streaming tokens) is not "reading history".
 */
export function shouldFollowPinnedChatTail(
  el: HTMLElement,
  prevScrollTop: number,
  prevScrollHeight: number,
  pinned: boolean,
): boolean {
  if (!pinned) return false;
  if (isChatScrollPinnedToBottom(el)) return true;
  const contentGrew = el.scrollHeight > prevScrollHeight + 1;
  const userScrolledUp = el.scrollTop < prevScrollTop - CHAT_SCROLL_USER_UPWARD_EPS;
  return contentGrew && !userScrolledUp;
}
