import { memo, useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

const CARD_LABEL_CLASS =
  'inline-flex max-w-full min-w-0 items-center gap-1 rounded-md bg-accent-soft/40 px-1.5 py-0.5 text-[11px] font-medium text-fg-muted [overflow-wrap:anywhere] dark:bg-accent-soft/25';

const CARD_PATH_CLASS =
  'inline-flex max-w-full min-w-0 items-center break-words rounded-md bg-surface-hover/60 px-1.5 py-0.5 font-mono text-xs text-fg [overflow-wrap:anywhere] dark:bg-surface-hover/35';

const CARD_PRE_CLASS =
  'max-h-72 w-full min-w-0 max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded-md bg-surface-hover/60 p-2 font-mono text-xs text-fg-muted [overflow-wrap:anywhere] dark:bg-surface-hover/35';

const CARD_SUMMARY_CLASS =
  'cursor-pointer select-none text-xs text-fg-subtle underline-offset-2 hover:text-fg-muted group-open:text-fg-muted';

export function ToolCardBadge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning' | 'accent';
}) {
  const toneClass =
    tone === 'positive'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      : tone === 'negative'
        ? 'bg-red-500/15 text-red-700 dark:text-red-300'
        : tone === 'warning'
          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
          : tone === 'accent'
            ? 'bg-accent-soft/70 text-accent-fg dark:bg-accent-soft/50'
            : '';
  return <span className={cn(CARD_LABEL_CLASS, toneClass)}>{children}</span>;
}

export function ToolCardPath({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <code className={CARD_PATH_CLASS} title={title}>
      {children}
    </code>
  );
}

export const ToolCardCopyButton = memo(function ToolCardCopyButton({
  text,
  label,
  copiedLabel,
}: {
  text: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = await copyTextToClipboard(text);
        if (ok) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }
      }}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-fg-muted',
        'hover:bg-surface-hover hover:text-fg',
        interaction.transition,
        interaction.focusRingPanel,
      )}
      aria-label={label}
      title={label}
    >
      {copied ? (
        <>
          <Check className="size-3" aria-hidden />
          <span>{copiedLabel}</span>
        </>
      ) : (
        <>
          <Copy className="size-3" aria-hidden />
          <span className="hidden sm:inline">{label}</span>
        </>
      )}
    </button>
  );
});

/** A `<details>`-based collapsible used inside cards; matches the existing chat aesthetic. */
export function ToolCardCollapsible({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group min-w-0 text-xs" open={defaultOpen}>
      <summary className={CARD_SUMMARY_CLASS}>{summary}</summary>
      <div className="mt-1.5 min-w-0">{children}</div>
    </details>
  );
}

export function ToolCardPre({ children }: { children: React.ReactNode }) {
  return <pre className={CARD_PRE_CLASS}>{children}</pre>;
}
