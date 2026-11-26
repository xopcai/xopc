import { useId } from 'react';

import { isExternalAgentKind, type ExternalAgentKind } from '@/features/settings/types/agent-gateway';
import { cn } from '@/lib/cn';

export const XOPC_RUNTIME_AVATAR_PREFIX = 'xopc:runtime:';

export function externalRuntimeDefaultAvatar(kind: ExternalAgentKind): string {
  return `${XOPC_RUNTIME_AVATAR_PREFIX}${kind}`;
}

export function parseExternalRuntimeAvatar(reference?: string | null): ExternalAgentKind | undefined {
  const trimmed = reference?.trim() ?? '';
  if (!trimmed.startsWith(XOPC_RUNTIME_AVATAR_PREFIX)) return undefined;
  const candidate = trimmed.slice(XOPC_RUNTIME_AVATAR_PREFIX.length);
  return isExternalAgentKind(candidate) ? candidate : undefined;
}

const CODEX_ROSETTE_PATH =
  'M252.794 108.802C289.191 99.0484 326.265 110.305 351.148 135.135C385.113 126.072 422.85 134.862 449.492 161.505C476.136 188.149 484.925 225.888 475.862 259.85V259.854C500.696 284.735 511.95 321.81 502.198 358.207C492.447 394.602 464.161 421.084 430.215 430.217C421.083 464.162 394.603 492.448 358.206 502.199C321.812 511.951 284.734 500.693 259.852 475.864C225.887 484.927 188.15 476.137 161.507 449.495C134.864 422.851 126.073 385.111 135.136 351.149C110.304 326.266 99.0496 289.192 108.801 252.795C118.552 216.4 146.84 189.918 180.784 180.785C189.917 146.841 216.396 118.553 252.794 108.802ZM374.292 407.145C374.292 411.271 372.092 415.086 368.517 417.148L283.723 466.102C302.487 480.585 327.555 486.459 352.217 479.852C386.997 470.532 410.068 439.312 410.555 405.006V317.717C410.555 315.08 409.125 312.621 406.843 311.303L374.292 292.509V407.145ZM251.868 415.897C248.296 417.959 243.893 417.959 240.317 415.897L155.526 366.942C152.366 390.436 159.811 415.08 177.866 433.136H177.863C203.325 458.594 241.896 462.962 271.85 446.232L347.449 402.586C349.735 401.268 351.148 398.8 351.148 396.163V358.579L251.868 415.897ZM368.602 220.628C366.319 219.309 363.474 219.318 361.191 220.637L328.641 239.431L427.921 296.749C431.496 298.811 433.697 302.627 433.697 306.752V404.661C455.622 395.654 473.244 376.881 479.851 352.218C489.169 317.442 473.668 281.85 444.201 264.274L368.602 220.628ZM177.303 206.34C155.377 215.348 137.756 234.122 131.148 258.783C121.832 293.561 137.331 329.153 166.799 346.727L242.398 390.373C244.68 391.692 247.525 391.684 249.807 390.366L282.357 371.572L183.078 314.253C179.504 312.189 177.303 308.375 177.303 304.251V206.34ZM259.849 279.145V331.858L305.5 358.213L351.15 331.858V279.145L305.5 252.789L259.849 279.145ZM327.276 144.9C308.512 130.418 283.445 124.543 258.782 131.15C224.002 140.471 200.931 171.691 200.445 205.995V293.286C200.445 295.923 201.875 298.381 204.158 299.7L236.707 318.493V203.856C236.707 199.731 238.909 195.916 242.483 193.853L327.276 144.9ZM433.137 177.867C407.675 152.407 369.103 148.038 339.149 164.769L263.55 208.415C261.265 209.734 259.852 212.202 259.852 214.838V252.423L359.132 195.105C362.703 193.041 367.108 193.041 370.682 195.105L455.473 244.06C458.635 220.567 451.189 195.922 433.135 177.867H433.137Z';

const AGY_ARCH_PATH =
  'M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z';

const CLAUDE_STARBURST_PATH =
  'M12 2.2l1.15 6.45 4.95-4.3-2.65 6.0 6.35-1.15-5.65 3.3 5.65 3.3-6.35-1.15 2.65 6.0-4.95-4.3L12 21.8l-1.15-6.45-4.95 4.3 2.65-6.0-6.35 1.15 5.65-3.3-5.65-3.3 6.35 1.15-2.65-6.0 4.95 4.3L12 2.2z';

/** Circular brand avatar for external coding runtimes (Codex, Antigravity, Claude Code, etc.). */
export function ExternalRuntimeAvatar({
  kind,
  size = 44,
  className,
}: {
  kind: ExternalAgentKind;
  size?: number;
  className?: string;
}) {
  const uid = useId().replace(/:/g, '');
  if (kind === 'codex') {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-900 text-white ring-1 ring-inset ring-white/15',
          className,
        )}
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg viewBox="100 100 411 411" className="h-[64%] w-[64%]" fill="none" aria-hidden>
          <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d={CODEX_ROSETTE_PATH} />
        </svg>
      </span>
    );
  }

  if (kind === 'claude') {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#D97757] text-white ring-1 ring-inset ring-black/10 dark:ring-white/15',
          className,
        )}
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg viewBox="0 0 24 24" className="h-[64%] w-[64%]" fill="none" aria-hidden>
          <path fill="currentColor" d={CLAUDE_STARBURST_PATH} />
        </svg>
      </span>
    );
  }

  const clipId = `agy-clip-${uid}`;
  const baseGrad = `agy-base-${uid}`;
  const greenGrad = `agy-green-${uid}`;
  const yellowGrad = `agy-yellow-${uid}`;
  const redGrad = `agy-red-${uid}`;
  const blueGrad = `agy-blue-${uid}`;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-inset ring-slate-200/90 dark:bg-slate-900 dark:ring-white/15',
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" fill="none" aria-hidden>
        <defs>
          <clipPath id={clipId}>
            <path d={AGY_ARCH_PATH} />
          </clipPath>
          <linearGradient id={baseGrad} x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#3186FF" />
            <stop offset="35%" stopColor="#00B95C" />
            <stop offset="68%" stopColor="#FBBC04" />
            <stop offset="100%" stopColor="#FC413D" />
          </linearGradient>
          <radialGradient id={greenGrad} cx="18%" cy="48%" r="48%">
            <stop offset="0%" stopColor="#00B95C" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#00B95C" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={yellowGrad} cx="35%" cy="15%" r="45%">
            <stop offset="0%" stopColor="#FFE432" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#FFE432" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={redGrad} cx="85%" cy="22%" r="48%">
            <stop offset="0%" stopColor="#FC413D" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#FC413D" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={blueGrad} cx="65%" cy="80%" r="55%">
            <stop offset="0%" stopColor="#3186FF" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#3186FF" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect x="-2" y="0" width="28" height="26" fill={`url(#${baseGrad})`} />
          <rect x="-2" y="0" width="28" height="26" fill={`url(#${greenGrad})`} />
          <rect x="-2" y="0" width="28" height="26" fill={`url(#${yellowGrad})`} />
          <rect x="-2" y="0" width="28" height="26" fill={`url(#${redGrad})`} />
          <rect x="-2" y="0" width="28" height="26" fill={`url(#${blueGrad})`} />
        </g>
      </svg>
    </span>
  );
}
