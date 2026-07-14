/**
 * Official provider logo SVGs sourced from Simple Icons (simpleicons.org, MIT/CC0)
 * and OpenAI brand assets. All paths use viewBox="0 0 24 24" for consistency.
 */
import type { ReactNode, SVGAttributes } from 'react';

import { cn } from '@/lib/cn';

type IconProps = {
  className?: string;
} & Pick<SVGAttributes<SVGSVGElement>, 'aria-hidden'>;

const PROVIDERS_WITH_LOGOS = new Set([
  'anthropic',
  'deepseek',
  'google',
  'kimi-coding',
  'minimax',
  'openai',
]);

export function hasProviderLogo(providerId: string): boolean {
  return PROVIDERS_WITH_LOGOS.has(providerId);
}

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
function DeepSeekIcon({ className, ...rest }: IconProps) {
  return (
    <IconShell className={className} {...rest}>
      <path
        fill="#5786FE"
        d="M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45"
      />
    </IconShell>
  );
}

/** MiniMax — official logo from Simple Icons. */
function MiniMaxIcon({ className, ...rest }: IconProps) {
  return (
    <IconShell className={className} {...rest}>
      <path
        fill="#E73562"
        d="M11.43 3.92a.86.86 0 1 0-1.718 0v14.236a1.999 1.999 0 0 1-3.997 0V9.022a.86.86 0 1 0-1.718 0v3.87a1.999 1.999 0 0 1-3.997 0V11.49a.57.57 0 0 1 1.139 0v1.404a.86.86 0 0 0 1.719 0V9.022a1.999 1.999 0 0 1 3.997 0v9.134a.86.86 0 0 0 1.719 0V3.92a1.998 1.998 0 1 1 3.996 0v11.788a.57.57 0 1 1-1.139 0zm10.572 3.105a2 2 0 0 0-1.999 1.997v7.63a.86.86 0 0 1-1.718 0V3.923a1.999 1.999 0 0 0-3.997 0v16.16a.86.86 0 0 1-1.719 0V18.08a.57.57 0 1 0-1.138 0v2a1.998 1.998 0 0 0 3.996 0V3.92a.86.86 0 0 1 1.719 0v12.73a1.999 1.999 0 0 0 3.996 0V9.023a.86.86 0 1 1 1.72 0v6.686a.57.57 0 0 0 1.138 0V9.022a2 2 0 0 0-1.998-1.997"
      />
    </IconShell>
  );
}

/** Moonshot AI / Kimi — official logo from Simple Icons. */
function KimiCodingIcon({ className, ...rest }: IconProps) {
  return (
    <IconShell className={className} {...rest}>
      <path
        fill="currentColor"
        d="m1.053 16.91 9.538 2.55a21 20.981 0 0 0 .06 2.031l5.956 1.592a12 11.99 0 0 1-15.554-6.172m-1.02-5.79 11.352 3.035a21 20.981 0 0 0-.469 2.01l10.817 2.89a12 11.99 0 0 1-1.845 2.004L.658 15.918a12 11.99 0 0 1-.625-4.796m1.593-5.146L13.573 9.17a21 20.981 0 0 0-1.01 1.874l11.297 3.02a21 20.981 0 0 1-.67 2.362l-11.55-3.087L.125 10.26a12 11.99 0 0 1 1.499-4.285ZM6.067 1.58l11.285 3.016a21 20.981 0 0 0-1.688 1.719l7.824 2.091a21 20.981 0 0 1 .513 2.664L2.107 5.218a12 11.99 0 0 1 3.96-3.638M21.68 4.866 7.222 1.003A12 11.99 0 0 1 21.68 4.866"
      />
    </IconShell>
  );
}

/** OpenAI — official logo (CC0, widely used canonical path). */
function OpenAIIcon({ className, ...rest }: IconProps) {
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
function AnthropicIcon({ className, ...rest }: IconProps) {
  return (
    <IconShell className={className} {...rest}>
      <path
        fill="#D4A27F"
        d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"
      />
    </IconShell>
  );
}

/** Google Gemini — official logo from Simple Icons (star/sparkle shape). */
function GoogleAIIcon({ className, ...rest }: IconProps) {
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
