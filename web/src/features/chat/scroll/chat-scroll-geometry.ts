/** Pixels from scroll bottom: past this, viewport is treated as "reading history" (must match list stick guard). */
export const CHAT_SCROLL_UNPIN_BEYOND_PX = 4;
/** When unpinned, re-pin only when this close to the bottom again (hysteresis: keep < UNPIN). */
export const CHAT_SCROLL_REPIN_WITHIN_PX = 2;

export function chatScrollDistanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}
