/**
 * Swipe-open registry — ensures only one SwipeableRow is open at a time.
 *
 * When a row opens, it registers its close callback. When another row opens,
 * the registry calls the previous callback to close it.
 */

type CloseCallback = () => void;

let currentClose: CloseCallback | null = null;

/** Register a row's close callback; closes any previously open row. */
export function registerSwipeOpen(close: CloseCallback): void {
  if (currentClose && currentClose !== close) {
    currentClose();
  }
  currentClose = close;
}

/** Unregister a row's close callback (e.g. when it closes itself). */
export function unregisterSwipeOpen(close: CloseCallback): void {
  if (currentClose === close) {
    currentClose = null;
  }
}

/** Close the currently open row, if any. */
export function closeCurrentSwipe(): void {
  if (currentClose) {
    currentClose();
  }
}
