import { ExternalRuntimeAvatar } from '@/components/brand/external-runtime-avatar';
import type { ExternalAgentKind, ExternalContextAccess } from '@/features/settings/types/agent-gateway';
import { cn } from '@/lib/cn';

/** Human-readable display label for an external coding runtime. */
export function externalRuntimeLabel(
  kind: ExternalAgentKind,
  variant: 'short' | 'full' = 'full',
): string {
  if (kind === 'codex') return 'Codex';
  if (kind === 'claude') return variant === 'short' ? 'Claude' : 'Claude Code';
  return 'AGY';
}

/** Human-readable summary of an external agent's xopc context access tier. */
export function externalContextAccessLabel(
  access: ExternalContextAccess | undefined,
  zh: boolean,
): string {
  const mode = access ?? 'read_only';
  if (mode === 'off') return zh ? '上下文关闭' : 'Context off';
  if (mode === 'brief_only') return zh ? '仅简报' : 'Brief only';
  if (mode === 'read_write') return zh ? '读写上下文' : 'Read & write context';
  return zh ? '只读上下文' : 'Read-only context';
}

/**
 * Restrained pill showing an agent's external runtime (Codex / AGY / Claude).
 * Defaults to a neutral slate pill per the Calm Intelligence design system.
 */
export function ExternalRuntimePill({
  kind,
  variant = 'short',
  tone = 'neutral',
  className,
}: {
  kind: ExternalAgentKind;
  variant?: 'short' | 'full';
  tone?: 'neutral' | 'accent';
  className?: string;
}) {
  const label = externalRuntimeLabel(kind, variant);
  return (
    <span
      data-external-runtime-pill={kind}
      className={cn(
        'inline-flex shrink-0 items-center rounded font-medium leading-none',
        tone === 'accent'
          ? 'rounded-full border border-accent/25 bg-accent-soft px-2 py-0.5 text-[11px] text-accent'
          : 'bg-surface-hover px-1.5 py-0.5 text-[10px] text-fg-muted',
        className,
      )}
    >
      {label}
    </span>
  );
}

/** Tiny corner overlay badge for custom avatars or channel icons backed by an external runtime. */
export function ExternalRuntimeCornerBadge({
  kind,
  size = 10,
  ringClassName = 'ring-surface-panel',
  className,
}: {
  kind: ExternalAgentKind;
  size?: number;
  ringClassName?: string;
  className?: string;
}) {
  return (
    <span
      data-external-runtime-badge={kind}
      className={cn(
        'pointer-events-none absolute -bottom-0.5 -right-0.5 inline-flex items-center justify-center rounded-full ring-[1.5px]',
        ringClassName,
        className,
      )}
      aria-hidden
    >
      <ExternalRuntimeAvatar kind={kind} size={size} />
    </span>
  );
}
