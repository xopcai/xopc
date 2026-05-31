import { Cloud, Globe, MonitorPlay, Puzzle, ShieldCheck, Webhook } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { SettingsFormSection } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';

import { BackendModeList, type BackendMode, type BackendModeOption } from './browser/backend-mode-list';
import { BrowserBehaviorSections } from './browser/browser-behavior-sections';
import { BrowserDocsLink } from './browser/browser-docs-link';
import { browserFocusElementId, parseBrowserSettingsFocus } from './browser/browser-focus';
import { BrowserSetupGuide } from './browser/browser-setup-guide';
import { BrowserStatusStrip } from './browser/browser-status-strip';
import {
  doctorStatus,
  extensionDoctorStatus,
  extensionStatusLabelFor,
  selectedBackendStatus,
  statusLabelFor,
} from './browser/browser-status';
import { BrowserWorkspace } from './browser/browser-workspace';
import { CdpCard } from './browser/cdp-card';
import { CloakCard } from './browser/cloak-card';
import { CloudCard } from './browser/cloud-card';
import { ExtensionCard } from './browser/extension-card';
import { LocalCard } from './browser/local-card';
import { useBrowserDoctor } from './browser/use-browser-doctor';
import { useBrowserInstallStream } from './browser/use-browser-install-stream';

function workspaceSubtitle(backend: BackendMode, a: AgentDefaultsPanelProps['a']): string {
  switch (backend) {
    case 'extension':
      return a.browserWorkspaceExtSubtitle;
    case 'local':
      return a.browserWorkspaceLocalSubtitle;
    case 'cloakbrowser':
      return a.browserWorkspaceCloakSubtitle;
    case 'cdp':
      return a.browserWorkspaceCdpSubtitle;
    case 'cloud':
      return a.browserWorkspaceCloudSubtitle;
  }
}

function workspaceFocusId(backend: BackendMode): string {
  switch (backend) {
    case 'extension':
      return browserFocusElementId('extension');
    case 'local':
      return browserFocusElementId('local');
    case 'cloakbrowser':
      return browserFocusElementId('cloak');
    case 'cdp':
      return browserFocusElementId('cdp');
    case 'cloud':
      return browserFocusElementId('cloud');
  }
}

export function AgentDefaultsBrowserPanel(props: AgentDefaultsPanelProps) {
  const { a, form, update } = props;
  const language = useLocaleStore((s) => s.language);
  const [searchParams, setSearchParams] = useSearchParams();
  const focus = parseBrowserSettingsFocus(searchParams.get('focus'));

  const playwrightInstall = useBrowserInstallStream('playwright');
  const cloakInstall = useBrowserInstallStream('cloakbrowser');

  const doctor = useBrowserDoctor({
    cacheDir: form.browserCloakCacheDir,
    binaryPath: form.browserCloakBinaryPath,
    browserEnabled: form.browserEnabled,
    activeBackend: form.browserBackend,
    extensionHost: form.browserExtensionHost,
    extensionPort: form.browserExtensionPort,
  });

  const localStatus = doctorStatus(doctor.playwright);
  const cloakStatus = doctorStatus(doctor.cloak);
  const extensionStatus = extensionDoctorStatus(doctor.extension);
  const extensionStatusLabel = extensionStatusLabelFor(doctor.extension, a);

  const statusByBackend = useMemo(
    () => ({
      extension: { status: extensionStatus, statusLabel: extensionStatusLabel },
      local: { status: localStatus, statusLabel: statusLabelFor(localStatus, a) },
      cloakbrowser: { status: cloakStatus, statusLabel: statusLabelFor(cloakStatus, a) },
    }),
    [a, cloakStatus, extensionStatus, extensionStatusLabel, localStatus],
  );

  const modeOptions = useMemo<BackendModeOption[]>(() => {
    const base: BackendModeOption[] = [
      {
        value: 'extension',
        icon: Puzzle,
        name: a.browserBackendExtension,
        tagline: a.browserModeExtTagline,
      },
      {
        value: 'local',
        icon: MonitorPlay,
        name: a.browserBackendLocal,
        tagline: a.browserModeLocalTagline,
      },
      {
        value: 'cloakbrowser',
        icon: ShieldCheck,
        name: a.browserBackendCloakBrowser,
        tagline: a.browserModeCloakTagline,
      },
      {
        value: 'cdp',
        icon: Webhook,
        name: a.browserBackendCdp,
        tagline: a.browserModeCdpTagline,
      },
      {
        value: 'cloud',
        icon: Cloud,
        name: a.browserBackendCloud,
        tagline: a.browserModeCloudTagline,
      },
    ];

    const active = form.browserBackend;
    const probed = statusByBackend[active as keyof typeof statusByBackend];
    return base.map((opt) =>
      opt.value === active && probed
        ? { ...opt, status: probed.status, statusLabel: probed.statusLabel }
        : opt,
    );
  }, [a, form.browserBackend, statusByBackend]);

  const selectedOption = modeOptions.find((o) => o.value === form.browserBackend) ?? modeOptions[0];
  const SelectedIcon = selectedOption.icon;
  const stripStatus = selectedBackendStatus(form.browserBackend, {
    extensionStatus,
    extensionStatusLabel,
    localStatus,
    cloakStatus,
    a,
  });

  useEffect(() => {
    if (!focus) return undefined;
    const targetId = browserFocusElementId(focus);
    const timer = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('focus');
        return next;
      },
      { replace: true },
    );
    return () => window.clearTimeout(timer);
  }, [focus, setSearchParams]);

  const startSetup = (backend: Extract<BackendMode, 'extension' | 'local' | 'cloud'>) => {
    update({ browserEnabled: true, browserBackend: backend });
  };

  return (
    <div className="flex flex-col gap-5">
      {!form.browserEnabled ? (
        <BrowserSetupGuide m={a} onStart={startSetup} />
      ) : null}

      <SettingsFormSection>
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover/90 text-fg-muted"
                aria-hidden
              >
                <Globe className="size-4" strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <AgentDefaultsField label={a.label.browserEnabled} description={a.desc.browserEnabled}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-fg">
                    <input
                      type="checkbox"
                      className="size-3.5 shrink-0 rounded border-edge"
                      checked={form.browserEnabled}
                      onChange={(e) => update({ browserEnabled: e.target.checked })}
                    />
                    <span>{a.browserEnabledOn}</span>
                  </label>
                </AgentDefaultsField>
              </div>
            </div>
            <BrowserDocsLink language={language} label={a.browserDocsLink} className="shrink-0 pt-1" />
          </div>

          {form.browserEnabled ? (
            <BrowserStatusStrip
              m={a}
              backendName={selectedOption.name}
              status={stripStatus.status}
              statusLabel={stripStatus.statusLabel}
            />
          ) : (
            <p className="text-xs text-fg-muted">{a.browserDisabledHint}</p>
          )}
        </div>
      </SettingsFormSection>

      <div
        className={cn(
          'flex flex-col gap-5 transition-opacity',
          !form.browserEnabled && 'pointer-events-none opacity-40',
        )}
        aria-hidden={!form.browserEnabled}
      >
        <SettingsFormSection>
          <div id={browserFocusElementId('connection')} className="scroll-mt-24">
            <BackendModeList
              m={a}
              value={form.browserBackend}
              onChange={(next) => update({ browserBackend: next })}
              options={modeOptions}
            />
          </div>
        </SettingsFormSection>

        <div id={workspaceFocusId(form.browserBackend)} className="scroll-mt-24">
          <BrowserWorkspace
            icon={SelectedIcon}
            title={selectedOption.name}
            subtitle={workspaceSubtitle(form.browserBackend, a)}
          >
            {form.browserBackend === 'local' ? (
              <LocalCard
                embedded
                m={a}
                doctor={doctor.playwright}
                refetch={doctor.refetchPlaywright}
                applyDoctor={doctor.applyPlaywrightDoctor}
                installStream={playwrightInstall}
              />
            ) : null}
            {form.browserBackend === 'cloakbrowser' ? (
              <CloakCard
                embedded
                m={a}
                doctor={doctor.cloak}
                refetch={doctor.refetchCloak}
                applyDoctor={doctor.applyCloakDoctor}
                installStream={cloakInstall}
                form={{
                  cacheDir: form.browserCloakCacheDir,
                  binaryPath: form.browserCloakBinaryPath,
                  keepOpen: form.browserCloakKeepOpen,
                  temporaryProfile: form.browserCloakTemporaryProfile,
                  humanize: form.browserHumanize,
                  humanPreset: form.browserHumanPreset,
                  timezone: form.browserCloakTimezone,
                  locale: form.browserCloakLocale,
                  webrtcIp: form.browserCloakWebrtcIp,
                  fingerprintPlatform: form.browserCloakFingerprintPlatform,
                  extraArgs: form.browserCloakExtraArgs,
                }}
                onChange={(patch) =>
                  update({
                    ...(patch.cacheDir !== undefined ? { browserCloakCacheDir: patch.cacheDir } : {}),
                    ...(patch.binaryPath !== undefined ? { browserCloakBinaryPath: patch.binaryPath } : {}),
                    ...(patch.keepOpen !== undefined ? { browserCloakKeepOpen: patch.keepOpen } : {}),
                    ...(patch.temporaryProfile !== undefined
                      ? { browserCloakTemporaryProfile: patch.temporaryProfile }
                      : {}),
                    ...(patch.humanize !== undefined ? { browserHumanize: patch.humanize } : {}),
                    ...(patch.humanPreset !== undefined ? { browserHumanPreset: patch.humanPreset } : {}),
                    ...(patch.timezone !== undefined ? { browserCloakTimezone: patch.timezone } : {}),
                    ...(patch.locale !== undefined ? { browserCloakLocale: patch.locale } : {}),
                    ...(patch.webrtcIp !== undefined ? { browserCloakWebrtcIp: patch.webrtcIp } : {}),
                    ...(patch.fingerprintPlatform !== undefined
                      ? { browserCloakFingerprintPlatform: patch.fingerprintPlatform }
                      : {}),
                    ...(patch.extraArgs !== undefined ? { browserCloakExtraArgs: patch.extraArgs } : {}),
                  })
                }
              />
            ) : null}
            {form.browserBackend === 'cdp' ? (
              <CdpCard
                embedded
                m={a}
                cdpUrl={form.browserCdpUrl}
                onCdpUrlChange={(next) => update({ browserCdpUrl: next })}
                launch={doctor.launchCdp}
                stop={doctor.stopCdp}
                listInstances={doctor.listCdpInstances}
                ping={doctor.pingCdp}
              />
            ) : null}
            {form.browserBackend === 'cloud' ? (
              <CloudCard
                embedded
                m={a}
                form={{
                  provider: form.browserCloudProvider,
                  apiKey: form.browserCloudApiKey,
                  projectId: form.browserCloudProjectId,
                  region: form.browserCloudRegion,
                }}
                onChange={(patch) =>
                  update({
                    ...(patch.provider !== undefined ? { browserCloudProvider: patch.provider } : {}),
                    ...(patch.apiKey !== undefined ? { browserCloudApiKey: patch.apiKey } : {}),
                    ...(patch.projectId !== undefined ? { browserCloudProjectId: patch.projectId } : {}),
                    ...(patch.region !== undefined ? { browserCloudRegion: patch.region } : {}),
                  })
                }
                testCloud={doctor.testCloud}
              />
            ) : null}
            {form.browserBackend === 'extension' ? (
              <ExtensionCard
                embedded
                m={a}
                probe={doctor.extension}
                artifacts={doctor.extensionArtifacts}
                form={{
                  port: form.browserExtensionPort,
                  host: form.browserExtensionHost,
                  connectionTimeoutMs: form.browserExtensionConnectionTimeout,
                }}
                onChange={(patch) =>
                  update({
                    ...(patch.port !== undefined ? { browserExtensionPort: patch.port } : {}),
                    ...(patch.host !== undefined ? { browserExtensionHost: patch.host } : {}),
                    ...(patch.connectionTimeoutMs !== undefined
                      ? { browserExtensionConnectionTimeout: patch.connectionTimeoutMs }
                      : {}),
                  })
                }
                startBridge={doctor.startExtensionBridge}
                stopBridge={doctor.stopExtensionBridge}
                disconnectExtension={doctor.disconnectExtension}
                installArtifacts={doctor.installExtensionArtifacts}
                refetchArtifacts={doctor.refetchExtensionArtifacts}
                openExtensionChrome={doctor.openExtensionChrome}
                revealExtensionFolder={doctor.revealExtensionFolder}
              />
            ) : null}
          </BrowserWorkspace>
        </div>

        <BrowserBehaviorSections a={a} form={form} update={update} />
      </div>
    </div>
  );
}
