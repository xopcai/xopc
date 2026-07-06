/** Vertical lift for floating bottom controls (command bar, chat input, search). */
export const FLOATING_BOTTOM_OFFSET = 6;

/** Minimum gap above the home indicator when safe-area inset is zero. */
export const FLOATING_BOTTOM_MIN_PADDING = 12;

export function floatingBottomPadding(bottomInset: number): number {
  return Math.max(bottomInset, FLOATING_BOTTOM_MIN_PADDING);
}
