import { Download, Info, Loader2, RefreshCw, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import { APP_CHROME_DRAG_CLASS, APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import type { UpdateReminderController } from '@/features/updater/use-update-reminder';
import { restartGatewayAfterConfigChange } from '@/features/tunnel/gateway-restart';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { showActivity } from '@/stores/activity-store';
import { useLocaleStore } from '@/stores/locale-store';
import { npmUpdateRestartIsAutomatic } from '@/features/updater/use-update-status';

/**
 * Full-width top strip: main copy is centered; optional actions (dismiss) on the far right; npm CTA sits after the text.
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
  const { show, dismiss, electronCheck, electronQuitAndInstall, runNpmUpdate, npmUpdateRunning } = reminder;

  const [restartBusy, setRestartBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onRestartGateway = useCallback(async () => {
    setRestartBusy(true);
    setActionError(null);
    try {
      const j = await restartGatewayAfterConfigChange();
      if (j.ok) {
        window.dispatchEvent(new Event('gateway-restart-initiated'));
        return;
      }
      setActionError(j.message ?? 'Gateway restart failed');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestartBusy(false);
    }
  }, []);

  const onNpmUpdateClick = useCallback(async () => {
    const tp = messages(language).updatePanel;
    setActionError(null);
    const r = await runNpmUpdate();
    if (r.ok) {
      showActivity({
        tone: 'success',
        title: tp.updateSuccess,
        message: npmUpdateRestartIsAutomatic(r.result)
          ? tp.updateSuccessAutoRestartDetail
          : tp.updateSuccessDetail,
        source: language === 'zh' ? '系统更新' : 'System update',
        dedupeKey: 'system-update',
      });
      return;
    }
    const title =
      r.error === 'git-checkout'
        ? tp.updateErrorGit
        : r.error === 'busy'
          ? tp.updateErrorBusy
          : tp.updateErrorFailed;
    setActionError(`${title}: ${r.message}`);
  }, [runNpmUpdate, language]);

  if (show.kind === 'none') {
    return null;
  }

  const actionsRight = cn(
    'absolute right-2 top-1/2 z-[1] flex -translate-y-1/2 items-center gap-1 sm:right-3',
    APP_CHROME_NO_DRAG_CLASS,
  );

  if (show.kind === 'electron-ready') {
    return (
      <div
        className={cn(
          'relative flex min-h-10 w-full min-w-0 items-center justify-center border-b border-accent/20 bg-accent/10 px-10 py-2 text-sm sm:px-12',
          APP_CHROME_DRAG_CLASS,
          compact && 'text-xs',
        )}
      >
        <div className="flex max-w-[min(100%,48rem)] items-center justify-center gap-2 text-center">
          <Download className="size-4 shrink-0 text-accent" aria-hidden />
          <span className="min-w-0">
            {t.reminderElectronReady.replace('{{version}}', show.version)}
          </span>
        </div>
        <div className={actionsRight}>
          <button
            type="button"
            onClick={electronQuitAndInstall}
            className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-on-accent hover:bg-accent/90"
          >
            <RefreshCw className="mr-1 inline size-3" />
            {t.restartToUpdate}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="rounded p-1 text-fg-muted hover:text-fg"
            aria-label={t.dismissAria}
            title={t.dismissHint}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  if (show.kind === 'electron-error') {
    return (
      <div
        className={cn(
          'relative flex min-h-10 w-full min-w-0 items-center justify-center border-b border-edge bg-surface-panel px-10 py-2 text-sm text-fg-muted sm:px-12',
          APP_CHROME_DRAG_CLASS,
          compact && 'text-xs',
        )}
      >
        <div className="flex w-full max-w-[52rem] min-w-0 flex-wrap items-center justify-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-center justify-center gap-2" role="status">
            <Info className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">
              {/(?:ERR_(?:CONNECTION_\w+|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|TIMED_OUT)|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ERR_NETWORK|network|timed?\s*out|socket hang up)/i.test(show.message)
                ? t.reminderElectronUpdateNetworkError
                : t.reminderElectronUpdateError}
            </span>
          </div>
          <button
            type="button"
            onClick={electronCheck}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium text-accent-fg hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent',
              APP_CHROME_NO_DRAG_CLASS,
            )}
          >
            <RefreshCw className="size-3" aria-hidden />
            {t.reminderElectronUpdateRetry}
          </button>
          {show.message && (
            <details className={cn('basis-full min-w-0 text-xs', APP_CHROME_NO_DRAG_CLASS)}>
              <summary className="mx-auto w-fit cursor-pointer rounded text-fg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">
                {t.reminderElectronUpdateDetails}
              </summary>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded border border-edge bg-surface-inset p-2 text-fg-muted select-text">
                {show.message}
              </pre>
            </details>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className={cn(actionsRight, 'rounded p-1 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent')}
          aria-label={t.dismissAria}
          title={t.dismissAria}
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  if (show.kind === 'electron-downloading') {
    return (
      <div
        className={cn(
          'relative flex min-h-10 w-full min-w-0 flex-col items-center justify-center gap-2 border-b border-edge bg-surface-panel px-10 py-2 text-sm text-fg-muted sm:flex-row sm:gap-4 sm:px-12',
          APP_CHROME_DRAG_CLASS,
          compact && 'text-xs',
        )}
      >
        <div className="flex max-w-full items-center justify-center gap-2 text-center">
          <Download className="size-4 shrink-0 animate-pulse" aria-hidden />
          <span>
            {t.reminderDownloading.replace('{{percent}}', String(show.percent))}
          </span>
        </div>
        <div className="h-1.5 w-full max-w-xs rounded-full bg-surface-inset sm:max-w-[12rem]">
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
          <X className="size-4" />
        </button>
      </div>
    );
  }

  if (show.kind === 'npm-restart-required') {
    return (
      <div
        className={cn(
          'relative flex min-h-10 w-full min-w-0 items-center justify-center border-b border-amber-500/25 bg-amber-500/10 py-2 text-sm',
          APP_CHROME_DRAG_CLASS,
          compact && 'text-xs',
        )}
      >
        <div className="mx-auto flex max-w-[min(100%,52rem)] flex-wrap items-center justify-center gap-x-2 gap-y-1 px-10 pr-14 text-center sm:px-12 sm:pr-16">
          <span>{t.restartRequired.replace('{{version}}', show.version)}</span>
          <button
            type="button"
            onClick={onRestartGateway}
            disabled={restartBusy}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded bg-accent px-2.5 py-1 text-xs font-medium text-on-accent hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60',
              APP_CHROME_NO_DRAG_CLASS,
            )}
          >
            {restartBusy ? (
              <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-3 shrink-0" aria-hidden />
            )}
            {t.restartGateway}
          </button>
          {actionError ? <span className="w-full text-xs text-danger" role="alert">{actionError}</span> : null}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className={actionsRight}
          aria-label={t.dismissAria}
          title={t.dismissHint}
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  if (show.kind === 'npm-restarting') {
    return (
      <div
        className={cn(
          'relative flex min-h-10 w-full min-w-0 items-center justify-center border-b border-accent/20 bg-accent/10 py-2 text-sm',
          APP_CHROME_DRAG_CLASS,
          compact && 'text-xs',
        )}
      >
        <div className="mx-auto flex max-w-[min(100%,52rem)] items-center justify-center gap-2 px-10 pr-14 text-center sm:px-12 sm:pr-16">
          <Loader2 className="size-4 shrink-0 animate-spin text-accent" aria-hidden />
          <span>{t.restartingAutomatically.replace('{{version}}', show.version)}</span>
        </div>
      </div>
    );
  }

  if (show.kind === 'npm') {
    return (
      <div
        className={cn(
          'relative hidden min-h-10 w-full min-w-0 items-center justify-center border-b border-accent/20 bg-accent/10 py-2 text-sm md:flex',
          APP_CHROME_DRAG_CLASS,
          compact && 'text-xs',
        )}
      >
        <div
          className={cn(
            'mx-auto flex max-w-[min(100%,52rem)] flex-wrap items-center justify-center gap-x-2 gap-y-1 px-10 pr-14 text-center sm:px-12 sm:pr-16',
          )}
        >
          <span>
            {t.reminderNpm.replace('{{version}}', show.version)}
            {show.channel && show.channel !== 'latest' ? ` (${show.channel})` : ''}
          </span>
          <button
            type="button"
            onClick={onNpmUpdateClick}
            disabled={npmUpdateRunning}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded bg-accent px-2.5 py-1 text-xs font-medium text-on-accent hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60',
              APP_CHROME_NO_DRAG_CLASS,
            )}
          >
            {npmUpdateRunning ? (
              <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-3 shrink-0" aria-hidden />
            )}
            {npmUpdateRunning ? t.updateRunning : t.updateNow}
          </button>
          {actionError ? <span className="w-full text-xs text-danger" role="alert">{actionError}</span> : null}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className={actionsRight}
          aria-label={t.dismissAria}
          title={t.dismissHint}
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return null;
}
