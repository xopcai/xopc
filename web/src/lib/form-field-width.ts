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

/** Model / combobox trigger: size to label, cap width, allow shrink in toolbars. */
export const comboboxTriggerLayoutClass =
  'inline-flex w-fit max-w-full min-w-[10rem] max-w-lg justify-between';
