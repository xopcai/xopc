/**
 * Native `<select>` and combobox triggers should not stretch full viewport width on large screens.
 * Still `w-full` within narrow columns so mobile layouts don’t overflow.
 */
export const nativeSelectMaxWidthClass = 'w-full max-w-md sm:max-w-lg';

/**
 * Shared calm appearance for native `<select>` (see `.ui-select` in `globals.css`).
 * Combine with {@link nativeSelectMaxWidthClass} in settings/forms.
 */
export const selectControlBaseClass = 'ui-select';

/** Popover combobox triggers (model picker, etc.): match `.ui-select` focus — border only, no focus ring. */
export const selectComboboxTriggerFocusClass =
  'focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-none focus-visible:border-edge data-[state=open]:border-edge';

/**
 * Bordered text/date/time/number/textarea — same quiet focus as `.ui-select` (no ring shadow).
 */
export const formControlBorderFocusClass =
  'focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-none focus-visible:border-edge';

/** Settings / API key fields — stronger border on focus, no ring. */
export const settingsInputFocusClass =
  'focus:outline-none focus-visible:outline-none focus:ring-0 focus:ring-offset-0 focus:shadow-none focus:border-edge-strong focus-visible:border-edge-strong';

/** Borderless search inputs — no outline / ring (global :focus-visible otherwise shows accent outline). */
export const bareInputFocusClass =
  'focus:outline-none focus-visible:outline-none focus:ring-0 focus:ring-offset-0 focus:shadow-none';

/** Model / combobox trigger: size to label, cap width, allow shrink in toolbars. */
export const comboboxTriggerLayoutClass =
  'inline-flex w-fit max-w-full min-w-[10rem] max-w-lg justify-between';
