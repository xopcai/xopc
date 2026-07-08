import { cn } from '@/lib/cn';
import { formControlBorderFocusClass } from '@/lib/form-field-width';

export const sectionTightClass = 'p-4 sm:px-5';
export const sectionHeaderTightClass = 'mb-3';
export const phasePanelClass = 'rounded-xl bg-surface-panel/60 p-3 shadow-surface sm:p-4';
export const numInputClass = cn(
  'mt-1 w-full rounded-lg border border-edge-subtle bg-surface-panel px-2.5 py-1.5 text-sm text-fg',
  formControlBorderFocusClass,
);
