import { CheckCircle2, Download, LoaderCircle, MonitorPlay, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';

import { BrowserInstallProgressPanel } from './browser-install-progress';
import { ActionResultBox, BackendModeCard, type ModeStatusKind } from './backend-mode-card';
import type { BrowserMessages, DoctorState, PlaywrightDoctor } from './types';
import type { BrowserInstallStream } from './use-browser-install-stream';

type InstallStatus = 'idle' | 'installing' | 'installed' | 'failed';

export function LocalCard({
  m,
  doctor,
  refetch,
  applyDoctor,
  installStream,
  embedded = false,
}: {
  m: BrowserMessages;
  doctor: DoctorState<PlaywrightDoctor>;
  refetch: () => Promise<void>;
  applyDoctor?: (data: PlaywrightDoctor) => void;
  installStream: BrowserInstallStream;
  embedded?: boolean;
}) {
  const [status, setStatus] = useState<InstallStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const { progress, running, cancelling, run: runInstall, reset: resetInstall, cancel } = installStream;

  const install = useCallback(async () => {
    setStatus('installing');
    setMessage(null);
    resetInstall();
    const result = await runInstall<PlaywrightDoctor>({
      fallbackError: m.browserPlaywrightInstallFailed,
    });
    if (!result.ok) {
      if (result.error === 'busy') {
        setStatus('installing');
        return;
      }
      if (result.error === 'cancelled') {
        setStatus('idle');
        setMessage(null);
        resetInstall();
        return;
      }
      setStatus('failed');
      setMessage(result.errorMessage ?? m.browserPlaywrightInstallFailed);
      return;
    }
    if (result.payload) {
      applyDoctor?.(result.payload);
    }
    setStatus('installed');
    setMessage(
      result.payload?.executablePath
        ? `${m.browserPlaywrightInstalled}: ${result.payload.executablePath}`
        : m.browserPlaywrightInstalled,
    );
    await refetch();
  }, [
    applyDoctor,
    m.browserPlaywrightInstallFailed,
    m.browserPlaywrightInstalled,
    refetch,
    resetInstall,
    runInstall,
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
  const installing = status === 'installing' || running;

  return (
    <BackendModeCard
      icon={MonitorPlay}
      title={m.browserPlaywrightGuideTitle}
      description={m.browserPlaywrightGuideDesc}
      status={statusKind}
      statusDetail={statusDetail}
      m={m}
      embedded={embedded}
      primaryAction={
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
          disabled={installing}
          onClick={() => void install()}
        >
          {installing ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : installed ? (
            <RefreshCw className="size-3.5" />
          ) : status === 'installed' ? (
            <CheckCircle2 className="size-3.5 text-green-500" />
          ) : (
            <Download className="size-3.5" />
          )}
          {installing
            ? m.browserPlaywrightInstalling
            : installed
              ? m.browserReinstall
              : m.browserPlaywrightInstall}
        </button>
      }
    >
      <div className="text-xs">
        <p className="text-fg-muted">{m.browserPlaywrightManualInstall}</p>
        <code className="mt-2 block w-fit rounded-md border border-edge bg-surface-base px-2 py-1 text-xs text-fg">
          node node_modules/playwright-core/cli.js install chromium
        </code>
      </div>
      {running ? (
        <BrowserInstallProgressPanel
          m={m}
          progress={progress}
          showLogs
          cancelling={cancelling}
          onCancel={() => void cancel()}
        />
      ) : null}
      {message ? (
        <ActionResultBox kind={status === 'failed' ? 'error' : 'success'} message={message} />
      ) : null}
    </BackendModeCard>
  );
}
