import { CheckCircle2, Download, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { useCallback, useState } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

import { AgentDefaultsField } from '../../agent-defaults-field';
import { inputClassName, selectClassName } from '../../defaults-field-styles';

import { BrowserInstallProgressPanel } from './browser-install-progress';
import { ActionResultBox, BackendModeCard, type ModeStatusKind } from './backend-mode-card';
import type { BrowserMessages, CloakDoctor, DoctorState } from './types';
import type { BrowserInstallStream } from './use-browser-install-stream';

type InstallStatus = 'idle' | 'installing' | 'installed' | 'failed';

export interface CloakCardForm {
  cacheDir: string;
  binaryPath: string;
  keepOpen: boolean;
  temporaryProfile: boolean;
  humanize: boolean;
  humanPreset: 'default' | 'careful';
}

export function CloakCard({
  m,
  doctor,
  refetch,
  applyDoctor,
  installStream,
  form,
  onChange,
}: {
  m: BrowserMessages;
  doctor: DoctorState<CloakDoctor>;
  refetch: (overrides?: { cacheDir?: string; binaryPath?: string }) => Promise<CloakDoctor | null>;
  applyDoctor?: (data: CloakDoctor) => void;
  installStream: BrowserInstallStream;
  form: CloakCardForm;
  onChange: (patch: Partial<CloakCardForm>) => void;
}) {
  const [status, setStatus] = useState<InstallStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { progress, running, cancelling, run: runInstall, reset: resetInstall, cancel } = installStream;

  const data = doctor.kind === 'ok' ? doctor.data : null;
  const installed = data?.installed === true;
  const installing = status === 'installing' || running;

  const installNow = useCallback(async () => {
    setConfirmOpen(false);
    setStatus('installing');
    setMessage(null);
    resetInstall();
    const result = await runInstall<CloakDoctor>({
      body: {
        cacheDir: form.cacheDir.trim() || undefined,
        binaryPath: form.binaryPath.trim() || undefined,
      },
      fallbackError: m.browserCloakInstallFailed,
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
      setMessage(result.errorMessage ?? m.browserCloakInstallFailed);
      return;
    }
    if (result.payload) {
      applyDoctor?.(result.payload);
    }
    setStatus('installed');
    setMessage(
      result.payload?.binaryPath ? `${m.browserCloakInstalled}: ${result.payload.binaryPath}` : m.browserCloakInstalled,
    );
    await refetch({
      cacheDir: form.cacheDir,
      binaryPath: form.binaryPath,
    });
  }, [
    applyDoctor,
    form.binaryPath,
    form.cacheDir,
    m.browserCloakInstallFailed,
    m.browserCloakInstalled,
    refetch,
    resetInstall,
    runInstall,
  ]);

  const statusKind: ModeStatusKind =
    doctor.kind === 'loading'
      ? 'checking'
      : doctor.kind === 'error'
        ? 'error'
        : installed
          ? 'ready'
          : 'not_installed';

  const statusDetail = installed && data?.version ? `v${data.version} (${data.platform})` : undefined;

  return (
    <>
      <BackendModeCard
        icon={ShieldCheck}
        title={m.browserCloakGuideTitle}
        description={m.browserCloakGuideDesc}
        status={statusKind}
        statusDetail={statusDetail}
        m={m}
        primaryAction={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
            disabled={installing}
            onClick={() => setConfirmOpen(true)}
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
              ? m.browserCloakInstalling
              : installed
                ? m.browserReinstall
                : m.browserCloakDownload}
          </button>
        }
      >
        {running ? (
          <BrowserInstallProgressPanel
            m={m}
            progress={progress}
            cancelling={cancelling}
            onCancel={() => void cancel()}
          />
        ) : null}

        {message ? (
          <ActionResultBox kind={status === 'failed' ? 'error' : 'success'} message={message} />
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <AgentDefaultsField label={m.label.browserCloakKeepOpen} description={m.desc.browserCloakKeepOpen}>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="size-3.5 shrink-0 rounded border-edge"
                checked={form.keepOpen}
                onChange={(e) => onChange({ keepOpen: e.target.checked })}
              />
              <span>{m.browserCloakKeepOpenOn}</span>
            </label>
          </AgentDefaultsField>
          <AgentDefaultsField
            label={m.label.browserCloakTemporaryProfile}
            description={m.desc.browserCloakTemporaryProfile}
          >
            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="size-3.5 shrink-0 rounded border-edge"
                checked={form.temporaryProfile}
                onChange={(e) => onChange({ temporaryProfile: e.target.checked })}
              />
              <span>{m.browserCloakTemporaryProfileOn}</span>
            </label>
          </AgentDefaultsField>
          <AgentDefaultsField label={m.label.browserHumanize} description={m.desc.browserHumanize}>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="size-3.5 shrink-0 rounded border-edge"
                checked={form.humanize}
                onChange={(e) => onChange({ humanize: e.target.checked })}
              />
              <span>{m.browserHumanizeOn}</span>
            </label>
          </AgentDefaultsField>
          <AgentDefaultsField label={m.label.browserHumanPreset} description={m.desc.browserHumanPreset}>
            <select
              className={selectClassName()}
              value={form.humanPreset}
              onChange={(e) => onChange({ humanPreset: e.target.value as 'default' | 'careful' })}
            >
              <option value="careful">{m.browserHumanPresetCareful}</option>
              <option value="default">{m.browserHumanPresetDefault}</option>
            </select>
          </AgentDefaultsField>
        </div>
      </BackendModeCard>

      {/* Advanced fields outside the card to keep its primary surface tidy */}
      <div className="grid gap-5 rounded-xl border border-edge bg-surface-base p-4 sm:grid-cols-2">
        <AgentDefaultsField label={m.label.browserCloakCacheDir} description={m.desc.browserCloakCacheDir}>
          <input
            type="text"
            className={inputClassName()}
            value={form.cacheDir}
            placeholder="~/.xopc/bin/cloakbrowser"
            onChange={(e) => onChange({ cacheDir: e.target.value })}
            autoComplete="off"
          />
          <p className="text-[11px] text-fg-subtle">{m.browserCacheDirHomeOnly}</p>
        </AgentDefaultsField>
        <AgentDefaultsField label={m.label.browserCloakBinaryPath} description={m.desc.browserCloakBinaryPath}>
          <input
            type="text"
            className={inputClassName()}
            value={form.binaryPath}
            placeholder="~/.xopc/bin/cloakbrowser/chromium-v.../Chromium.app/Contents/MacOS/Chromium"
            onChange={(e) => onChange({ binaryPath: e.target.value })}
            autoComplete="off"
          />
          {form.binaryPath.trim() ? (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">{m.browserBinaryPathWarning}</p>
          ) : null}
        </AgentDefaultsField>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={m.browserConfirmDownloadTitle}
        description={buildConfirmBody(m, data)}
        confirmLabel={m.browserConfirmDownloadConfirm}
        cancelLabel={m.browserConfirmDownloadCancel}
        onConfirm={() => void installNow()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

function buildConfirmBody(m: BrowserMessages, data: CloakDoctor | null): string {
  if (!data) return m.browserConfirmDownloadBody;
  const parts = [
    m.browserConfirmDownloadBody
      .replace('{{version}}', data.version ?? '—')
      .replace('{{platform}}', data.platform)
      .replace('{{url}}', data.downloadUrl || '—'),
  ];
  if (data.expectedSha256) {
    parts.push(`SHA-256: ${data.expectedSha256.slice(0, 16)}…`);
  } else {
    parts.push(m.browserCloakSha256Skipped);
  }
  return parts.join('\n');
}
