import type { AriaAttributes } from 'react';

import { cn } from '@/lib/cn';

type BrandLogoProps = {
  className?: string;
  alt?: string;
} & Pick<AriaAttributes, 'aria-hidden'>;

export function BrandLogo({ alt, className, 'aria-hidden': ariaHidden }: BrandLogoProps) {
  const label = alt?.trim() ? alt : undefined;
  const hide = ariaHidden ?? (label ? undefined : true);

  return (
    <span
      className={cn('relative inline-block shrink-0 overflow-hidden', className)}
      role="img"
      aria-hidden={hide}
      aria-label={label}
    >
      <img className="size-full object-contain dark:hidden" src="/logo.svg" alt="" aria-hidden="true" />
      <img className="hidden size-full object-contain dark:block" src="/logo-dark.svg" alt="" aria-hidden="true" />
    </span>
  );
}
