import { CheckCircle2, Download, LoaderCircle, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useReducer } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { uiPatchReducer } from '@/lib/settings-form-draft';

import { AgentDefaultsField } from '.././browser-settings-field';
import { inputClassName, selectClassName } from '../../agents/defaults-field-styles';

import { BrowserInstallProgressPanel } from './browser-install-progress';
import { ActionResultBox, BackendModeCard, type ModeStatusKind } from './backend-mode-card';
import type { BrowserMessages, CloakDoctor, CloakLaunchResult, CloakRuntimeStatus, DoctorState } from './types';
import type { BrowserInstallStream } from './use-browser-install-stream';

type InstallStatus = 'idle' | 'installing' | 'installed' | 'failed';
type OpenStatus = 'idle' | 'pending' | 'ok' | 'error';

type CloakCardUi = {
  confirmOpen: boolean;
  installStatus: InstallStatus;
  installMessage: string | null;
  openStatus: OpenStatus;
  openMessage: string | null;
  runtime: CloakRuntimeStatus | null;
};

const initialCloakCardUi: CloakCardUi = {
  confirmOpen: false,
  installStatus: 'idle',
  installMessage: null,
  openStatus: 'idle',
  openMessage: null,
  runtime: null,
};

export interface CloakCardForm {
  cacheDir: string;
  binaryPath: string;
  keepOpen: boolean;
  temporaryProfile: boolean;
  humanize: boolean;
  humanPreset: 'default' | 'careful';
  timezone: string;
  locale: string;
  webrtcIp: string;
  fingerprintPlatform: string;
  extraArgs: string;
}

export function CloakCard({
  m,
  doctor,
  refetch,
  applyDoctor,
  installStream,
  fetchRuntimeStatus,
  launchCloak,
  form,
  onChange,
  embedded = false,
}: {
  m: BrowserMessages;
  doctor: DoctorState<CloakDoctor>;
  refetch: (overrides?: { cacheDir?: string; binaryPath?: string }) => Promise<CloakDoctor | null>;
  applyDoctor?: (data: CloakDoctor) => void;
  installStream: BrowserInstallStream;
  fetchRuntimeStatus: () => Promise<CloakRuntimeStatus>;
  launchCloak: () => Promise<CloakLaunchResult>;
  form: CloakCardForm;
  onChange: (patch: Partial<CloakCardForm>) => void;
  embedded?: boolean;
}) {
  const [ui, dispatch] = useReducer(uiPatchReducer<CloakCardUi>, initialCloakCardUi);
  const { confirmOpen, installStatus, installMessage, openStatus, openMessage, runtime } = ui;
  const { progress, running, cancelling, run: runInstall, reset: resetInstall, cancel } = installStream;

  const data = doctor.kind === 'ok' ? doctor.data : null;
  const installed = data?.installed === true;
  const installing = installStatus === 'installing' || running;

  const refreshRuntime = useCallback(async () => {
    if (!installed) return;
    try {
      const next = await fetchRuntimeStatus();
      dispatch({ type: 'patch', patch: { runtime: next } });
    } catch {
      // non-blocking
    }
  }, [fetchRuntimeStatus, installed]);

  useEffect(() => {
    if (!installed) {
      dispatch({ type: 'patch', patch: { runtime: null } });
      return undefined;
    }
    void refreshRuntime();
    const id = setInterval(() => void refreshRuntime(), 8000);
    return () => clearInterval(id);
  }, [installed, refreshRuntime]);

  const installNow = useCallback(async () => {
    dispatch({ type: 'patch', patch: { confirmOpen: false, installStatus: 'installing', installMessage: null } });
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
        dispatch({ type: 'patch', patch: { installStatus: 'installing' } });
        return;
      }
      if (result.error === 'cancelled') {
        dispatch({ type: 'patch', patch: { installStatus: 'idle', installMessage: null } });
        resetInstall();
        return;
      }
      dispatch({
        type: 'patch',
        patch: { installStatus: 'failed', installMessage: result.errorMessage ?? m.browserCloakInstallFailed },
      });
      return;
    }
    if (result.payload) {
      applyDoctor?.(result.payload);
    }
    dispatch({
      type: 'patch',
      patch: {
        installStatus: 'installed',
        installMessage: result.payload?.binaryPath
          ? `${m.browserCloakInstalled}: ${result.payload.binaryPath}`
          : m.browserCloakInstalled,
      },
    });
    await refetch({
      cacheDir: form.cacheDir,
      binaryPath: form.binaryPath,
    });
    await refreshRuntime();
  }, [
    applyDoctor,
    form.binaryPath,
    form.cacheDir,
    m.browserCloakInstallFailed,
    m.browserCloakInstalled,
    refetch,
    refreshRuntime,
    resetInstall,
    runInstall,
  ]);

  const onOpenBrowser = useCallback(async () => {
    if (openStatus === 'pending') return;
    dispatch({ type: 'patch', patch: { openStatus: 'pending', openMessage: null } });
    try {
      const result = await launchCloak();
      dispatch({
        type: 'patch',
        patch: {
          openStatus: 'ok',
          openMessage: result.reused
            ? m.browserCloakOpenReused.replace('{{port}}', String(result.port))
            : m.browserCloakOpenLaunched.replace('{{port}}', String(result.port)),
          runtime: result,
        },
      });
    } catch (e) {
      dispatch({
        type: 'patch',
        patch: {
          openStatus: 'error',
          openMessage: e instanceof Error ? e.message : String(e),
        },
      });
    }
  }, [launchCloak, m.browserCloakOpenLaunched, m.browserCloakOpenReused, openStatus]);

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
        embedded={embedded}
        primaryAction={
          <div className="flex flex-wrap items-center gap-2">
            {installed ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
                disabled={openStatus === 'pending'}
                onClick={() => void onOpenBrowser()}
              >
                {openStatus === 'pending' ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                {openStatus === 'pending' ? m.browserCloakOpening : m.browserCloakOpen}
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
              disabled={installing}
              onClick={() => dispatch({ type: 'patch', patch: { confirmOpen: true } })}
            >
              {installing ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : installed ? (
                <RefreshCw className="size-3.5" />
              ) : installStatus === 'installed' ? (
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
          </div>
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

        {installMessage ? (
          <ActionResultBox kind={installStatus === 'failed' ? 'error' : 'success'} message={installMessage} />
        ) : null}

        {openMessage ? (
          <ActionResultBox kind={openStatus === 'error' ? 'error' : 'success'} message={openMessage} />
        ) : null}

        {installed && runtime ? (
          <div className="flex flex-col gap-2 rounded-lg border border-edge bg-surface-base p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-fg">
                {runtime.running
                  ? m.browserCloakRuntimeRunning.replace('{{port}}', String(runtime.port))
                  : m.browserCloakRuntimeOff}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-fg-subtle">{m.browserCloakProfileLabel}</span>
              <span className="break-all font-mono text-[11px] text-fg-muted">{runtime.userDataDir}</span>
            </div>
            <p className="text-[11px] leading-relaxed text-fg-subtle">{m.browserCloakProfileAgentHint}</p>
            {runtime.temporaryProfile ? (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">{m.browserCloakTemporaryProfileHint}</p>
            ) : null}
          </div>
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

      <SettingsFormSection className="mt-4 border border-edge-subtle">
        <SettingsFormSectionHeader icon={ShieldCheck} title={m.browserCloakAdvancedShow} />
        <div className="grid gap-5 sm:grid-cols-2">
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
          <AgentDefaultsField label={m.label.browserCloakTimezone} description={m.desc.browserCloakTimezone}>
            <input
              type="text"
              className={inputClassName()}
              value={form.timezone}
              placeholder="America/New_York"
              onChange={(e) => onChange({ timezone: e.target.value })}
              autoComplete="off"
            />
          </AgentDefaultsField>
          <AgentDefaultsField label={m.label.browserCloakLocale} description={m.desc.browserCloakLocale}>
            <input
              type="text"
              className={inputClassName()}
              value={form.locale}
              placeholder="en-US"
              onChange={(e) => onChange({ locale: e.target.value })}
              autoComplete="off"
            />
          </AgentDefaultsField>
          <AgentDefaultsField label={m.label.browserCloakWebrtcIp} description={m.desc.browserCloakWebrtcIp}>
            <input
              type="text"
              className={inputClassName()}
              value={form.webrtcIp}
              placeholder="203.0.113.10"
              onChange={(e) => onChange({ webrtcIp: e.target.value })}
              autoComplete="off"
            />
          </AgentDefaultsField>
          <AgentDefaultsField
            label={m.label.browserCloakFingerprintPlatform}
            description={m.desc.browserCloakFingerprintPlatform}
          >
            <input
              type="text"
              className={inputClassName()}
              value={form.fingerprintPlatform}
              placeholder="macos"
              onChange={(e) => onChange({ fingerprintPlatform: e.target.value })}
              autoComplete="off"
            />
          </AgentDefaultsField>
          <div className="sm:col-span-2">
            <AgentDefaultsField label={m.label.browserCloakExtraArgs} description={m.desc.browserCloakExtraArgs}>
              <textarea
                className={cnInputTextarea()}
                value={form.extraArgs}
                placeholder="--disable-dev-shm-usage"
                rows={3}
                onChange={(e) => onChange({ extraArgs: e.target.value })}
              />
            </AgentDefaultsField>
          </div>
        </div>
      </SettingsFormSection>

      <ConfirmDialog
        open={confirmOpen}
        title={m.browserConfirmDownloadTitle}
        description={buildConfirmBody(m, data)}
        confirmLabel={m.browserConfirmDownloadConfirm}
        cancelLabel={m.browserConfirmDownloadCancel}
        onConfirm={() => void installNow()}
        onCancel={() => dispatch({ type: 'patch', patch: { confirmOpen: false } })}
      />
    </>
  );
}

function cnInputTextarea(): string {
  return `${inputClassName()} min-h-[4.5rem] resize-y font-mono text-xs`;
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
