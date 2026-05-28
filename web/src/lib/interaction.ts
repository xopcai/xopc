/**
 * Design system §7.1 — six-state controls: default, hover (via component styles),
 * active (press), focus-visible, disabled, loading (spinner/skeleton at call site).
 */
const pressFeedback =
  'transition-transform duration-150 ease-out active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100';

/** Large selectable cards / tiles — subtler press than icon buttons. */
const pressCardFeedback =
  'transition-transform duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100';

export const interaction = {
  transition: 'transition-colors duration-150 ease-out',
  press: pressFeedback,
  pressCard: pressCardFeedback,
  /** Focus ring on surfaces that use `bg-surface-panel` (main column, cards on panel). */
  focusRingPanel:
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
  /** Focus ring on inset / recessed `bg-surface-base` regions. */
  focusRingBase:
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
  disabled: 'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
} as const;

/** Ghost-style icon hit target (toolbar on cards, etc.). */
export const ghostIconButton =
  'rounded-lg p-2 text-fg-muted transition-colors transition-transform duration-150 ease-out hover:bg-surface-hover hover:text-fg active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel';
