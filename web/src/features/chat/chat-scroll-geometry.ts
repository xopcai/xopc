/** Pixels from scroll bottom: past this, viewport is treated as "reading history" (must match list stick guard). */
export const CHAT_SCROLL_UNPIN_BEYOND_PX = 24;
/** When unpinned, re-pin only when this close to the bottom again. */
export const CHAT_SCROLL_REPIN_WITHIN_PX = 12;

export function chatScrollDistanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}
