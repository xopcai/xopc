import { CheckCircle2, Download, LoaderCircle, MonitorPlay, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';

import { BrowserInstallProgressPanel } from './browser-install-progress';
import { ActionResultBox, BackendModeCard, type ModeStatusKind } from './backend-mode-card';
import type { BrowserMessages, DoctorState, PlaywrightDoctor } from './types';
import { useBrowserInstallStream } from './use-browser-install-stream';

type InstallStatus = 'idle' | 'installing' | 'installed' | 'failed';

export function LocalCard({
  m,
  doctor,
  refetch,
}: {
  m: BrowserMessages;
  doctor: DoctorState<PlaywrightDoctor>;
  refetch: () => Promise<void>;
}) {
  const [status, setStatus] = useState<InstallStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const { progress, running, run: runInstall, reset: resetInstall } = useBrowserInstallStream();

  const install = useCallback(async () => {
    if (status === 'installing' || running) return;
    setStatus('installing');
    setMessage(null);
    resetInstall();
    const result = await runInstall({
      path: '/api/browser/playwright/install/stream',
      fallbackError: m.browserPlaywrightInstallFailed,
    });
    if (!result.ok) {
      setStatus('failed');
      setMessage(result.errorMessage ?? m.browserPlaywrightInstallFailed);
      return;
    }
    setStatus('installed');
    setMessage(m.browserPlaywrightInstalled);
    await refetch();
  }, [
    m.browserPlaywrightInstallFailed,
    m.browserPlaywrightInstalled,
    refetch,
    resetInstall,
    runInstall,
    running,
    status,
  ]);

  const statusKind: ModeStatusKind =
    doctor.kind === 'loading'
      ? 'checking'
      : doctor.kind === 'error'
        ? 'error'
        : doctor.kind === 'ok'
          ? doctor.data.installed
            ? 'ready'
            : 'not_installed'
          : 'unknown';

  const statusDetail =
    doctor.kind === 'ok' && doctor.data.installed && doctor.data.executablePath
      ? doctor.data.executablePath
      : undefined;

  const installed = doctor.kind === 'ok' && doctor.data.installed;

  return (
    <BackendModeCard
      icon={MonitorPlay}
      title={m.browserPlaywrightGuideTitle}
      description={m.browserPlaywrightGuideDesc}
      status={statusKind}
      statusDetail={statusDetail}
      m={m}
      primaryAction={
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
          disabled={status === 'installing' || running}
          onClick={() => void install()}
        >
          {status === 'installing' ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : installed ? (
            <RefreshCw className="size-3.5" />
          ) : status === 'installed' ? (
            <CheckCircle2 className="size-3.5 text-green-500" />
          ) : (
            <Download className="size-3.5" />
          )}
          {status === 'installing' || running
            ? m.browserPlaywrightInstalling
            : installed
              ? m.browserReinstall
              : m.browserPlaywrightInstall}
        </button>
      }
    >
      <code className="w-fit rounded-md border border-edge bg-surface-base px-2 py-1 text-xs text-fg">
        npx playwright install chromium
      </code>
      {running ? <BrowserInstallProgressPanel m={m} progress={progress} showLogs /> : null}
      {message ? (
        <ActionResultBox kind={status === 'failed' ? 'error' : 'success'} message={message} />
      ) : null}
    </BackendModeCard>
  );
}
