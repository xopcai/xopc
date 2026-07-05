/** Select triggers should not stretch full viewport width on large screens. */
export const selectFieldMaxWidthClass = 'w-full max-w-md sm:max-w-lg';

/** Shared select trigger layout hook; visual styling lives in the shared Select component. */
export const selectTriggerClass = 'w-full';

/** Popover combobox triggers (model picker, etc.): border-only focus, no focus ring. */
export const selectComboboxTriggerFocusClass =
  'focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-none focus-visible:border-edge data-[state=open]:border-edge';

/** Bordered text/date/time/number/textarea — quiet border-only focus. */
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
