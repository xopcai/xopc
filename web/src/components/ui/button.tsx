import { Slot } from '@radix-ui/react-slot';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const variantClass: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white shadow-sm hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
  secondary:
    'bg-surface-panel text-fg border border-edge shadow-sm hover:bg-surface-hover dark:border-edge',
  ghost: 'text-fg-muted hover:bg-surface-hover hover:text-fg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', asChild = false, type = 'button', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref as never}
        type={asChild ? undefined : type}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all',
          'disabled:pointer-events-none disabled:opacity-50 active:scale-95',
          variantClass[variant],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';
