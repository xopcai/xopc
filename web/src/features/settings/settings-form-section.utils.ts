/**
 * Settings pages sit on `bg-surface-panel`; grouped blocks use `bg-surface-base`
 * to keep the white content region readable without losing hierarchy.
 */
export function settingsFormSectionClassName(): string {
  return 'rounded-2xl border border-edge-subtle bg-surface-base px-4 py-5 sm:px-5';
}
