import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, CheckCircle, Download, Loader2, RefreshCw, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import { BrandLogo } from '@/components/shell/brand-logo';
import { XOPC_ELECTRON_UPDATE_RECHECK_EVENT } from '@/features/updater/use-update-reminder';
import {
  npmUpdateRestartIsAutomatic,
  useUpdateStatus,
} from '@/features/updater/use-update-status';
import type { ElectronUpdateState, NpmUpdateStatus } from '@/features/updater/use-update-status';
import { messages } from '@/i18n/messages';
import { webBuildInfo } from '@/lib/build-info';
import { cn } from '@/lib/cn';
import { fetchJson } from '@/lib/fetch';
import { showActivity } from '@/stores/activity-store';
import { apiUrl } from '@/lib/url';
import { useAsyncResource } from '@/lib/use-async-resource';
import { useLocaleStore } from '@/stores/locale-store';

const REPO_URL = 'https://github.com/xopcai/xopc';

const BUILD_DATE_ZH = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const BUILD_DATE_EN = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

type GatewayHealth = {
  version?: string;
  service?: string;
};

function formatBuildDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return (locale === 'zh' ? BUILD_DATE_ZH : BUILD_DATE_EN).format(d);
  } catch {
    return d.toISOString();
  }
}

export function AboutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const d = m.aboutDialog;
  const tp = m.updatePanel;
  const { isElectron, electron, electronCheck, checkNow, npm, runNpmUpdate, npmUpdateRunning } = useUpdateStatus();

  const [manualCheckTriggered, setManualCheckTriggered] = useState(false);
  const [npmCheckBusy, setNpmCheckBusy] = useState(false);
  const [npmCheckFailed, setNpmCheckFailed] = useState(false);
  const [npmUpgradeError, setNpmUpgradeError] = useState<string | null>(null);

  const { data: gatewayVersion } = useAsyncResource(
    async () => {
      const data = await fetchJson<GatewayHealth>(apiUrl('/health'));
      return typeof data.version === 'string' ? data.version : null;
    },
    [open],
    { enabled: open, initial: null as string | null, errorData: null },
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setManualCheckTriggered(false);
        setNpmCheckBusy(false);
        setNpmCheckFailed(false);
        setNpmUpgradeError(null);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  const handleNpmUpgrade = useCallback(async () => {
    setNpmUpgradeError(null);
    const panel = messages(language).updatePanel;
    const r = await runNpmUpdate();
    if (r.ok) {
      showActivity({
        tone: 'success',
        title: panel.updateSuccess,
        message: npmUpdateRestartIsAutomatic(r.result)
          ? panel.updateSuccessAutoRestartDetail
          : panel.updateSuccessDetail,
        source: language === 'zh' ? '系统更新' : 'System update',
        dedupeKey: 'system-update',
      });
      return;
    }
    const title =
      r.error === 'git-checkout'
        ? panel.updateErrorGit
        : r.error === 'busy'
          ? panel.updateErrorBusy
          : panel.updateErrorFailed;
    setNpmUpgradeError(`${title}: ${r.message}`);
  }, [runNpmUpdate, language]);

  const commit = webBuildInfo.commit;
  const localeTag = language === 'zh' ? 'zh-CN' : 'en-US';
  const buildDate = formatBuildDate(webBuildInfo.buildTimeIso, localeTag);
  const year = new Date().getFullYear();
  const copyright = d.copyright.replace('{year}', String(year));

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[200] bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 z-[201] w-[min(100%-2rem,26rem)] -translate-x-1/2 -translate-y-1/2',
            'rounded-2xl border border-edge bg-surface-panel shadow-popover dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-2 px-4 pt-3" aria-hidden>
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </div>

          <div className="px-6 pb-2 pt-1">
            <div className="flex justify-end">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label={d.close}
                >
                  <X className="size-4" strokeWidth={2} />
                </button>
              </Dialog.Close>
            </div>

            <div className="-mt-2 flex flex-col items-center text-center">
              <BrandLogo className="size-[4.5rem]" alt={m.appBrand} />
              <Dialog.Title className="mt-3 text-xl font-semibold tracking-tight text-fg">
                {m.appBrand}
              </Dialog.Title>
              <Dialog.Description className="sr-only">{d.windowTitle}</Dialog.Description>
            </div>

            <div className="mt-6 space-y-3 text-sm">
              <div className="grid grid-cols-[5.5rem_1fr] items-center gap-x-3 gap-y-1">
                <span className="text-fg-muted">{d.versionLabel}</span>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:justify-start">
                  <span className="font-mono text-[13px] text-fg tabular-nums">{webBuildInfo.version}</span>
                  <button
                    type="button"
                    className={cn(
                      'shrink-0 rounded-md border border-edge bg-surface-base px-2 py-0.5 text-[11px] font-medium text-fg-muted',
                      'transition-colors hover:bg-surface-hover hover:text-fg',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    )}
                    onClick={() => {
                      if (isElectron) {
                        window.dispatchEvent(new CustomEvent(XOPC_ELECTRON_UPDATE_RECHECK_EVENT));
                        setManualCheckTriggered(true);
                        electronCheck();
                      } else {
                        setManualCheckTriggered(true);
                        setNpmCheckFailed(false);
                        setNpmCheckBusy(true);
                        void (async () => {
                          const ok = await checkNow();
                          setNpmCheckBusy(false);
                          if (!ok) setNpmCheckFailed(true);
                        })();
                      }
                    }}
                    disabled={
                      (isElectron &&
                        ['checking', 'available', 'downloading', 'downloaded'].includes(electron?.state ?? '')) ||
                      (!isElectron && (npmCheckBusy || npmUpdateRunning))
                    }
                  >
                    {isElectron && electron?.state === 'checking' ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="size-3 animate-spin" />
                        {d.checkUpdatesChecking}
                      </span>
                    ) : !isElectron && npmCheckBusy ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="size-3 animate-spin" />
                        {d.checkUpdatesChecking}
                      </span>
                    ) : (
                      d.checkUpdates
                    )}
                  </button>
                </div>
              </div>
              {isElectron && manualCheckTriggered && (
                <ElectronUpdateHint
                  state={electron?.state}
                  version={electron?.version}
                  percent={electron?.percent}
                  d={d}
                />
              )}
              {!isElectron && manualCheckTriggered && (
                <NpmAboutUpdateHint
                  checking={npmCheckBusy}
                  checkFailed={npmCheckFailed}
                  npm={npm}
                  npmUpdateRunning={npmUpdateRunning}
                  upgradeError={npmUpgradeError}
                  onUpgrade={handleNpmUpgrade}
                  d={d}
                  tp={tp}
                />
              )}

              <div className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1">
                <span className="pt-0.5 text-fg-muted">{d.commitLabel}</span>
                <span className="break-all font-mono text-[11px] leading-snug text-fg">{commit}</span>
              </div>

              <div className="grid grid-cols-[5.5rem_1fr] items-baseline gap-x-3 gap-y-1">
                <span className="text-fg-muted">{d.buildDateLabel}</span>
                <span className="text-right text-[13px] text-fg sm:text-left">{buildDate}</span>
              </div>

              <div className="grid grid-cols-[5.5rem_1fr] items-baseline gap-x-3 gap-y-1">
                <span className="text-fg-muted">{d.gatewayVersionLabel}</span>
                <span className="text-right font-mono text-[13px] text-fg sm:text-left">
                  {gatewayVersion ?? d.gatewayUnavailable}
                </span>
              </div>

              <p className="pt-0.5 text-[11px] text-fg-subtle">{d.consoleBuildHint}</p>
            </div>

            <div className="mt-6 border-t border-edge-subtle pt-4 text-center text-[11px] leading-relaxed text-fg-muted">
              <p>
                <a
                  className="text-accent-fg underline decoration-accent-fg/40 underline-offset-2 hover:decoration-accent-fg"
                  href={REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {d.repositoryLink}
                </a>
              </p>
              <p className="mt-2">{copyright}</p>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ElectronUpdateHint({
  state,
  version,
  percent,
  d,
}: {
  state?: ElectronUpdateState;
  version?: string;
  percent?: number;
  d: {
    checkUpdatesChecking: string;
    checkUpdatesUpToDate: string;
    checkUpdatesAvailable: string;
    checkUpdatesDownloading: string;
    checkUpdatesDownloaded: string;
    checkUpdatesError: string;
  };
}) {
  if (!state || state === 'idle') return null;

  if (state === 'checking') {
    return (
      <p className="flex items-center gap-2 text-[12px] text-fg-muted">
        <Loader2 className="size-3.5 animate-spin" />
        <span>{d.checkUpdatesChecking}</span>
      </p>
    );
  }
  if (state === 'not-available') {
    return (
      <p className="flex items-center gap-2 text-[12px] text-green-600 dark:text-green-400">
        <CheckCircle className="size-3.5" />
        <span>{d.checkUpdatesUpToDate}</span>
      </p>
    );
  }
  if (state === 'available') {
    return (
      <p className="flex items-center gap-2 text-[12px] text-accent-fg">
        <RefreshCw className="size-3.5" />
        <span>{d.checkUpdatesAvailable.replace('{version}', version ?? '?')}</span>
      </p>
    );
  }
  if (state === 'downloading') {
    return (
      <p className="flex items-center gap-2 text-[12px] text-fg-muted">
        <Download className="size-3.5 motion-safe:animate-[bounce_1s_ease-out_infinite]" />
        <span>{d.checkUpdatesDownloading.replace('{percent}', String(Math.round(percent ?? 0)))}</span>
      </p>
    );
  }
  if (state === 'downloaded') {
    return (
      <p className="flex items-center gap-2 text-[12px] font-semibold text-accent-fg">
        <Download className="size-3.5" />
        <span>{d.checkUpdatesDownloaded.replace('{version}', version ?? '?')}</span>
      </p>
    );
  }
  if (state === 'error') {
    return (
      <p className="flex items-center gap-2 text-[12px] text-red-500 dark:text-red-400">
        <AlertCircle className="size-3.5" />
        <span>{d.checkUpdatesError}</span>
      </p>
    );
  }
  return null;
}

function NpmAboutUpdateHint({
  checking,
  checkFailed,
  npm,
  npmUpdateRunning,
  upgradeError,
  onUpgrade,
  d,
  tp,
}: {
  checking: boolean;
  checkFailed: boolean;
  npm: NpmUpdateStatus | null;
  npmUpdateRunning: boolean;
  upgradeError: string | null;
  onUpgrade: () => void;
  d: {
    checkUpdatesChecking: string;
    checkUpdatesUpToDate: string;
    checkUpdatesError: string;
  };
  tp: {
    reminderNpm: string;
    updateNow: string;
    updateRunning: string;
  };
}) {
  if (checking) {
    return (
      <p className="flex items-center gap-2 text-[12px] text-fg-muted">
        <Loader2 className="size-3.5 animate-spin" />
        <span>{d.checkUpdatesChecking}</span>
      </p>
    );
  }
  if (checkFailed) {
    return (
      <p className="flex items-center gap-2 text-[12px] text-red-500 dark:text-red-400">
        <AlertCircle className="size-3.5" />
        <span>{d.checkUpdatesError}</span>
      </p>
    );
  }
  if (npmUpdateRunning) {
    return (
      <p className="flex items-center gap-2 text-[12px] text-fg-muted">
        <Loader2 className="size-3.5 animate-spin" />
        <span>{tp.updateRunning}</span>
      </p>
    );
  }
  if (upgradeError) {
    return (
      <p className="flex items-start gap-2 text-[12px] text-red-500 dark:text-red-400" role="alert">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
        <span>{upgradeError}</span>
      </p>
    );
  }
  if (npm?.updateAvailable && npm.latestVersion) {
    return (
      <div className="space-y-2">
        <p className="flex items-start gap-2 text-[12px] text-accent-fg">
          <RefreshCw className="mt-0.5 size-3.5 shrink-0" />
          <span>{tp.reminderNpm.replace('{{version}}', npm.latestVersion)}</span>
        </p>
        <button
          type="button"
          onClick={onUpgrade}
          className={cn(
            'w-full rounded-lg bg-accent px-3 py-1.5 text-center text-xs font-medium text-white',
            'hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          {tp.updateNow}
        </button>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 text-[12px] text-green-600 dark:text-green-400">
      <CheckCircle className="size-3.5" />
      <span>{d.checkUpdatesUpToDate}</span>
    </p>
  );
}
