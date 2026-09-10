import type { AriaAttributes } from 'react';

import { cn } from '@/lib/cn';

type AnimatedLoopLogoProps = {
  className?: string;
  alt?: string;
} & Pick<AriaAttributes, 'aria-hidden'>;

/**
 * Brand narrative: a human-owned loop becomes an 80% AI / 20% human partnership.
 * The final frame uses the exact geometry of the canonical static mark.
 */
export function AnimatedLoopLogo({ alt, className, 'aria-hidden': ariaHidden }: AnimatedLoopLogoProps) {
  const label = alt?.trim() ? alt : undefined;
  const hide = ariaHidden ?? (label ? undefined : true);

  return (
    <span
      className={cn('xopc-loop-logo relative inline-block shrink-0', className)}
      role="img"
      aria-hidden={hide}
      aria-label={label}
    >
      <svg className="size-full overflow-visible" viewBox="0 0 1024 1024" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="xopc-onboarding-ai-glass" x1="198" y1="180" x2="826" y2="844" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--xopc-loop-ai-highlight)" />
            <stop offset="0.46" stopColor="var(--xopc-loop-ai)" />
            <stop offset="1" stopColor="var(--xopc-loop-ai-shadow)" />
          </linearGradient>
          <linearGradient id="xopc-onboarding-human-glass" x1="340" y1="224" x2="700" y2="816" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--xopc-loop-human-highlight)" />
            <stop offset="0.52" stopColor="var(--xopc-loop-human)" />
            <stop offset="1" stopColor="var(--xopc-loop-human-shadow)" />
          </linearGradient>
        </defs>

        <circle className="xopc-loop-logo__ambient" cx="512" cy="512" r="330" />
        <circle className="xopc-loop-logo__origin" cx="512" cy="512" r="330" />
        <circle
          className="xopc-loop-logo__ai-glow"
          cx="512"
          cy="512"
          r="330"
          strokeDasharray="1419.162121 654.289030"
          transform="rotate(11.8 512 512)"
        />
        <circle
          className="xopc-loop-logo__ai"
          cx="512"
          cy="512"
          r="330"
          stroke="url(#xopc-onboarding-ai-glass)"
          strokeDasharray="1419.162121 654.289030"
          transform="rotate(11.8 512 512)"
        />
        <circle
          className="xopc-loop-logo__human"
          cx="512"
          cy="512"
          r="330"
          stroke="url(#xopc-onboarding-human-glass)"
          strokeDasharray="354.790530 1718.660621"
          transform="rotate(284.2 512 512)"
        />
        <circle
          className="xopc-loop-logo__liquid-front"
          cx="512"
          cy="512"
          r="330"
          strokeDasharray="58 2015.451151"
          transform="rotate(11.8 512 512)"
        />
      </svg>
    </span>
  );
}
