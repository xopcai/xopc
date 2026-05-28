/**
 * Official provider logo SVGs sourced from Simple Icons (simpleicons.org, MIT/CC0)
 * and OpenAI brand assets. All paths use viewBox="0 0 24 24" for consistency.
 */
import type { ReactNode, SVGAttributes } from 'react';

import { cn } from '@/lib/cn';

type IconProps = {
  className?: string;
} & Pick<SVGAttributes<SVGSVGElement>, 'aria-hidden'>;

function IconShell({ className, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      {...rest}
    >
      {children}
    </svg>
  );
}

/** DeepSeek — official logo from Simple Icons. */
export function DeepSeekIcon({ className, ...rest }: IconProps) {
  return (
    <IconShell className={className} {...rest}>
      <path
        fill="#4D6BFE"
        d="M12.63 5.43c-.377-.222-.676-.093-.676.28v1.63c0 .55.18 1.8.52 1.52l.026.03 3.99 2.28 6.43 2.14 1.48-.085 3.13-.284 4.99-1.86.47.23.96.32 1.78.39.63.05 1.23-.031 1.70-.129.73-.155.68-.836.41-.961-2.15-1.00-1.68-.595-2.11-.926 1.09-1.29 2.76-3.59 3.28-6.73.05-.346.11-.834.10-1.11-.004-.171.03-.238.23-.257a4.2 4.2 0 0 0 1.54-.475c1.39-.763 1.96-2.01 2.09-3.51.02-.23-.004-.467-.247-.588M11.58 18.16c-2.08-1.64-3.10-2.18-3.52-2.16-.39.02-.32.47-.234.76.09.28.21.48.37.74.11.17.19.42-.113.60-.673.41-1.84-.14-1.89-.168-1.36-.801-2.5-1.86-3.30-3.30-.775-1.39-1.22-2.88-1.29-4.48-.02-.385.09-.522.47-.592a4.7 4.7 0 0 1 1.53-.038c2.13.31 3.94 1.26 5.46 2.77.87.86 1.52 1.88 2.20 2.89.72 1.06 1.49 2.08 2.48 2.91.35.29.63.51.89.67-.802.09-2.14.10-3.05-.615zm1.00-6.44a.306.30 0 0 1 .415-.287.3.3 0 0 1 .113.07.3.3 0 0 1 .086.21c0 .17-.136.30-.308.30a.303.30 0 0 1-.306-.307m3.11 1.59c-.2.08-.4.15-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.25.25 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.76-.136 1.14.02.35.14.61.41 1.0.78.39.45.46.58.68.92.17.26.33.54.44.85.6.19-.02.35-.25.45"
      />
    </IconShell>
  );
}

/** MiniMax — official logo from Simple Icons. */
export function MiniMaxIcon({ className, ...rest }: IconProps) {
  return (
    <IconShell className={className} {...rest}>
      <path
        fill="currentColor"
        d="M11.43 3.92a.86.86 0 1 0-1.71 0v14.23a1.99 1.99 0 0 1-3.99 0V9.02a.86.86 0 1 0-1.71 0v3.87a1.99 1.99 0 0 1-3.99 0V11.49a.57.57 0 0 1 1.13 0v1.40a.86.86 0 0 0 1.71 0V9.02a1.99 1.99 0 0 1 3.99 0v9.13a.86.86 0 0 0 1.71 0V3.92a1.99 1.99 0 1 1 3.99 0v11.78a.57.57 0 1 1-1.13 0zm10.57 3.10a2 2 0 0 0-1.99 1.99v7.63a.86.86 0 0 1-1.71 0V3.92a1.99 1.99 0 0 0-3.99 0v16.16a.86.86 0 0 1-1.71 0V18.08a.57.57 0 1 0-1.13 0v2a1.99 1.99 0 0 0 3.99 0V3.92a.86.86 0 0 1 1.71 0v12.73a1.99 1.99 0 0 0 3.99 0V9.02a.86.86 0 1 1 1.72 0v6.68a.57.57 0 0 0 1.13 0V9.02a2 2 0 0 0-1.99-1.99"
      />
    </IconShell>
  );
}

/** Moonshot AI / Kimi — official logo from Simple Icons. */
export function KimiCodingIcon({ className, ...rest }: IconProps) {
  return (
    <IconShell className={className} {...rest}>
      <path
        fill="#1A1A2E"
        d="m1.05 16.91 9.53 2.55a21 20.98 0 0 0 .06 2.03l5.95 1.59a12 11.99 0 0 1-15.55-6.17m-1.02-5.79 11.35 3.03a21 20.98 0 0 0-.469 2.01l10.81 2.89a12 11.99 0 0 1-1.84 2.00L.658 15.91a12 11.99 0 0 1-.625-4.79m1.59-5.14L13.57 9.17a21 20.98 0 0 0-1.01 1.87l11.29 3.02a21 20.98 0 0 1-.67 2.36l-11.55-3.08L.125 10.26a12 11.99 0 0 1 1.49-4.28ZM6.06 1.58l11.28 3.01a21 20.98 0 0 0-1.68 1.71l7.82 2.09a21 20.98 0 0 1 .513 2.66L2.10 5.21a12 11.99 0 0 1 3.96-3.63M21.68 4.86 7.22 1.00A12 11.99 0 0 1 21.68 4.86"
      />
    </IconShell>
  );
}

/** OpenAI — official logo (CC0, widely used canonical path). */
export function OpenAIIcon({ className, ...rest }: IconProps) {
  return (
    <IconShell className={className} {...rest}>
      <path
        fill="currentColor"
        d="M22.28 9.82a5.98 5.98 0 0 0-.516-4.91 6.04 6.04 0 0 0-6.51-2.9A6.06 6.06 0 0 0 4.98 4.18a5.98 5.98 0 0 0-3.99 2.9 6.04 6.04 0 0 0 .743 7.09 5.98 5.98 0 0 0 .511 4.91 6.05 6.05 0 0 0 6.51 2.9A5.98 5.98 0 0 0 13.26 24a6.05 6.05 0 0 0 5.77-4.20 5.98 5.98 0 0 0 3.99-2.9 6.05 6.05 0 0 0-.748-7.07zm-9.02 12.60a4.47 4.47 0 0 1-2.87-1.04l.142-.08 4.77-2.75a.795.79 0 0 0 .393-.681v-6.73l2.02 1.16a.071.07 0 0 1 .038.05v5.58a4.50 4.50 0 0 1-4.49 4.49zm-9.66-4.12a4.47 4.47 0 0 1-.535-3.01l.142.08 4.78 2.75a.771.77 0 0 0 .781 0l5.84-3.36v2.33a.08.08 0 0 1-.033.06L9.74 19.95a4.49 4.49 0 0 1-6.14-1.64zM2.34 7.89a4.48 4.48 0 0 1 2.36-1.97V11.6a.766.76 0 0 0 .388.67l5.81 3.35-2.02 1.16a.076.07 0 0 1-.071 0l-4.83-2.78A4.50 4.50 0 0 1 2.34 7.87zm16.59 3.85L13.10 8.36 15.11 7.2a.076.07 0 0 1 .071 0l4.83 2.79a4.49 4.49 0 0 1-.677 8.10v-5.67a.79.79 0 0 0-.407-.667zm2.01-3.02-.142-.085-4.77-2.78a.776.77 0 0 0-.785 0L9.40 9.23V6.89a.066.06 0 0 1 .028-.062l4.83-2.78a4.49 4.49 0 0 1 6.68 4.66zM8.30 12.86l-2.02-1.16a.08.08 0 0 1-.038-.057V6.07a4.49 4.49 0 0 1 7.37-3.45l-.142.08L8.70 5.45a.795.79 0 0 0-.393.68zm1.09-2.36 2.60-1.5 2.60 1.5v2.99l-2.59 1.5-2.60-1.5Z"
      />
    </IconShell>
  );
}

/** Anthropic — official logo from Simple Icons. */
export function AnthropicIcon({ className, ...rest }: IconProps) {
  return (
    <IconShell className={className} {...rest}>
      <path
        fill="#D4A27F"
        d="M17.30 3.54h-3.67l6.69 16.91H24Zm-10.60 0L0 20.45h3.74l1.36-3.55h7.00l1.36 3.55h3.74L10.53 3.54Zm-.371 10.22 2.29-5.94 2.29 5.94Z"
      />
    </IconShell>
  );
}

/** Google Gemini — official logo from Simple Icons (star/sparkle shape). */
export function GoogleAIIcon({ className, ...rest }: IconProps) {
  return (
    <IconShell className={className} {...rest}>
      <defs>
        <linearGradient id="gemini-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="50%" stopColor="#9B72CB" />
          <stop offset="100%" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path
        fill="url(#gemini-grad)"
        d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"
      />
    </IconShell>
  );
}

/** Map provider id to its logo component. */
export function ProviderLogo({ providerId, className }: { providerId: string; className?: string }) {
  const props = { className, 'aria-hidden': true as const };

  switch (providerId) {
    case 'deepseek':
      return <DeepSeekIcon {...props} />;
    case 'minimax':
      return <MiniMaxIcon {...props} />;
    case 'kimi-coding':
      return <KimiCodingIcon {...props} />;
    case 'moonshotai':
    case 'moonshotai-cn':
      return <KimiCodingIcon {...props} />;
    case 'openai':
      return <OpenAIIcon {...props} />;
    case 'anthropic':
      return <AnthropicIcon {...props} />;
    case 'google':
      return <GoogleAIIcon {...props} />;
    default:
      return <span className={cn('flex items-center justify-center text-2xl', className)}>🤖</span>;
  }
}
