/**
 * Segmented control shell — pill track + floating thumb (ui-design-system §5.1).
 * Pill track + thumb densities for shell controls.
 */

export const segmentedTrackClassName =
  'inline-flex items-center gap-px rounded-pill border border-edge bg-surface-hover px-1 py-0.5 dark:border-edge';

export const segmentedThumbBaseClassName =
  'inline-flex shrink-0 items-center justify-center rounded-pill text-xs font-medium leading-none transition-colors text-fg-subtle hover:text-fg active:scale-100';

/** Selected segment: raised surface on the gray track (reference: light “pill” thumb). */
export const segmentedThumbActiveClassName =
  'bg-surface-panel shadow-sm dark:bg-surface-panel dark:shadow-sm dark:ring-1 dark:ring-edge-strong/40';
