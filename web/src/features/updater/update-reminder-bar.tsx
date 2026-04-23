import { Download, RefreshCw, X } from 'lucide-react';

import type { UpdateReminderController } from '@/features/updater/use-update-reminder';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

/**
 * Full-width top strip: main copy is centered; actions stay on the right.
 */
export function UpdateReminderBar({
  reminder,
  compact,
}: {
  reminder: UpdateReminderController;
  compact?: boolean;
}) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).updatePanel;
  const { show, dismiss, electronQuitAndInstall } = reminder;

  if (show.kind === 'none') {
    return null;
  }

  const actionsRight = 'absolute right-2 top-1/2 z-[1] flex -translate-y-1/2 items-center gap-1 sm:right-3';

  if (show.kind === 'electron-ready') {
    return (
      <div
        className={cn(
          'relative flex min-h-10 w-full min-w-0 items-center justify-center border-b border-accent/20 bg-accent/10 px-10 py-2 text-sm sm:px-12',
          compact && 'text-xs',
        )}
      >
        <div className="flex max-w-[min(100%,48rem)] items-center justify-center gap-2 text-center">
          <Download className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span className="min-w-0">
            {t.reminderElectronReady.replace('{{version}}', show.version)}
          </span>
        </div>
        <div className={actionsRight}>
          <button
            type="button"
            onClick={electronQuitAndInstall}
            className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent/90"
          >
            <RefreshCw className="mr-1 inline h-3 w-3" />
            {t.restartToUpdate}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="rounded p-1 text-fg-muted hover:text-fg"
            aria-label={t.dismissAria}
            title={t.dismissHint}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (show.kind === 'electron-downloading') {
    return (
      <div
        className={cn(
          'relative flex min-h-10 w-full min-w-0 flex-col items-center justify-center gap-2 border-b border-edge bg-surface-secondary px-10 py-2 text-sm text-fg-muted sm:flex-row sm:gap-4 sm:px-12',
          compact && 'text-xs',
        )}
      >
        <div className="flex max-w-full items-center justify-center gap-2 text-center">
          <Download className="h-4 w-4 shrink-0 animate-pulse" aria-hidden />
          <span>
            {t.reminderDownloading.replace('{{percent}}', String(show.percent))}
          </span>
        </div>
        <div className="h-1.5 w-full max-w-xs rounded-full bg-surface-tertiary sm:max-w-[12rem]">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${show.percent}%` }}
          />
        </div>
        <button
          type="button"
          onClick={dismiss}
          className={cn(actionsRight, 'sm:right-2')}
          aria-label={t.dismissAria}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (show.kind === 'npm') {
    return (
      <div
        className={cn(
          'relative flex min-h-10 w-full min-w-0 items-center justify-center border-b border-accent/20 bg-accent/10 px-10 py-2 text-sm sm:px-12',
          compact && 'text-xs',
        )}
      >
        <div className="flex max-w-[min(100%,52rem)] flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
          <span className="inline-flex items-center gap-2">
            <Download className="h-4 w-4 shrink-0 text-accent" aria-hidden />
            <span>
              {t.reminderNpm.replace('{{version}}', show.version)}
              {show.channel && show.channel !== 'latest' ? ` (${show.channel})` : ''}
            </span>
          </span>
          {!compact ? (
            <code className="rounded bg-surface-secondary px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
              xopc update
            </code>
          ) : null}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className={actionsRight}
          aria-label={t.dismissAria}
          title={t.dismissHint}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return null;
}
