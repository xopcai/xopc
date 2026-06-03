/**
 * Settings content sits on `bg-surface-panel`; grouped blocks use a recessed `bg-surface-base`
 * lift instead of heavy borders (design system §2.1, §4.2).
 */
export function settingsFormSectionClassName(): string {
  return 'rounded-2xl bg-surface-base px-4 py-5 sm:px-5';
}
