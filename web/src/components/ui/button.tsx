import { Slot } from '@radix-ui/react-slot';
import { type ButtonHTMLAttributes, type Ref } from 'react';

import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'segmented';

const variantClass: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white shadow-surface hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
  secondary:
    'bg-surface-panel text-fg border border-edge shadow-surface hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel dark:border-edge',
  ghost:
    'text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
  /** Pill track segments: no hover styling — visual state is only selected vs unselected (`segmentedThumb*` + focus ring there). */
  segmented: '',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  asChild?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  className,
  variant = 'secondary',
  asChild = false,
  type = 'button',
  ref,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium',
        'transition-colors duration-150 ease-out transition-transform',
        'active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        variantClass[variant],
        className,
      )}
      {...props}
    />
  );
}
