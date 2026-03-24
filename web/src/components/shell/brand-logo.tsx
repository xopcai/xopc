import type { ImgHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

type BrandLogoProps = {
  className?: string;
} & Pick<ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'aria-hidden'>;

/** Serves from `web/public/logo.png` at `/logo.png`. */
export function BrandLogo({ alt, className, 'aria-hidden': ariaHidden }: BrandLogoProps) {
  return (
    <img
      src="/logo.png"
      alt={alt ?? ''}
      aria-hidden={ariaHidden}
      className={cn('shrink-0 object-contain', className)}
      width={256}
      height={256}
      decoding="async"
    />
  );
}
