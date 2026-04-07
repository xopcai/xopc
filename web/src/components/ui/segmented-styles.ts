/**
 * Segmented control shell — pill track + floating thumb (ui-design-system §5.1).
 * Pill track + thumb densities for shell controls.
 */

export const segmentedTrackClassName =
  'inline-flex items-center gap-px rounded-pill border border-edge bg-surface-hover p-1 dark:border-edge';

export const segmentedThumbBaseClassName =
  'inline-flex shrink-0 items-center justify-center rounded-pill text-xs font-medium leading-none transition-[color,background-color,box-shadow] duration-150 ease-out text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel active:scale-100';

/** Selected segment: raised surface on the gray track (reference: light “pill” thumb). */
export const segmentedThumbActiveClassName =
  'bg-surface-panel shadow-sm dark:bg-surface-panel dark:shadow-sm dark:ring-1 dark:ring-edge-strong/40';
