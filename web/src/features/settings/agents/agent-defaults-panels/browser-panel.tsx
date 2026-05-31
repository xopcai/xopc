import { Cloud, Globe, MonitorPlay, Puzzle, ShieldCheck, Webhook } from 'lucide-react';
import { useMemo } from 'react';

import { SettingsFormSection } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';

import {
  BackendModeList,
  type BackendMode,
  type BackendModeOption,
} from './browser/backend-mode-list';
import { BrowserBehaviorSections } from './browser/browser-behavior-sections';
import { BrowserDocsLink } from './browser/browser-docs-link';
import { browserFocusElementId } from './browser/browser-focus';
import { BrowserSetupGuide } from './browser/browser-setup-guide';
import { BrowserStatusStrip } from './browser/browser-status-strip';
import {
  doctorStatus,
  extensionDoctorStatus,
  extensionStatusLabelFor,
  selectedBackendStatus,
  statusLabelFor,
} from './browser/browser-status';
import type { BrowserTabId } from './browser/browser-tabs';
import { isBrowserBackendTab } from './browser/browser-tabs';
import { CdpCard } from './browser/cdp-card';
import { CloakCard } from './browser/cloak-card';
import { CloudCard } from './browser/cloud-card';
import { ExtensionCard } from './browser/extension-card';
import { LocalCard } from './browser/local-card';
import { useBrowserDoctor } from './browser/use-browser-doctor';
import { useBrowserInstallStream } from './browser/use-browser-install-stream';

export function AgentDefaultsBrowserPanel(
  props: AgentDefaultsPanelProps & {
    activeTab: BrowserTabId;
    setActiveTab: (tab: BrowserTabId) => void;
  },
) {
  const { a, form, update, activeTab, setActiveTab } = props;
  const language = useLocaleStore((s) => s.language);

  const playwrightInstall = useBrowserInstallStream('playwright');
  const cloakInstall = useBrowserInstallStream('cloakbrowser');

  const probeExtension = form.browserEnabled && (activeTab === 'overview' || activeTab === 'extension');
  const probeLocal = form.browserEnabled && (activeTab === 'overview' || activeTab === 'local');
  const probeCloak = form.browserEnabled && (activeTab === 'overview' || activeTab === 'cloakbrowser');

  const doctor = useBrowserDoctor({
    cacheDir: form.browserCloakCacheDir,
    binaryPath: form.browserCloakBinaryPath,
    browserEnabled: form.browserEnabled,
    activeBackend: form.browserBackend,
    probeExtension,
    probeLocal,
    probeCloak,
    extensionHost: form.browserExtensionHost,
    extensionPort: form.browserExtensionPort,
  });

  const localStatus = doctorStatus(doctor.playwright);
  const cloakStatus = doctorStatus(doctor.cloak);
  const extensionStatus = extensionDoctorStatus(doctor.extension);
  const extensionStatusLabel = extensionStatusLabelFor(doctor.extension, a);

  const stripStatus = selectedBackendStatus(form.browserBackend, {
    extensionStatus,
    extensionStatusLabel,
    localStatus,
    cloakStatus,
    a,
  });

  const modeOptions = useMemo<BackendModeOption[]>(() => {
    const base: BackendModeOption[] = [
      {
        value: 'extension',
        icon: Puzzle,
        name: a.browserBackendExtension,
        tagline: a.browserModeExtTagline,
        status: extensionStatus,
        statusLabel: extensionStatusLabel,
      },
      {
        value: 'local',
        icon: MonitorPlay,
        name: a.browserBackendLocal,
        tagline: a.browserModeLocalTagline,
        status: localStatus,
        statusLabel: statusLabelFor(localStatus, a),
      },
      {
        value: 'cloakbrowser',
        icon: ShieldCheck,
        name: a.browserBackendCloakBrowser,
        tagline: a.browserModeCloakTagline,
        status: cloakStatus,
        statusLabel: statusLabelFor(cloakStatus, a),
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
    return base;
  }, [a, cloakStatus, extensionStatus, extensionStatusLabel, localStatus]);

  const backendName = useMemo(() => {
    switch (form.browserBackend) {
      case 'extension':
        return a.browserBackendExtension;
      case 'local':
        return a.browserBackendLocal;
      case 'cloakbrowser':
        return a.browserBackendCloakBrowser;
      case 'cdp':
        return a.browserBackendCdp;
      case 'cloud':
        return a.browserBackendCloud;
    }
  }, [a, form.browserBackend]);

  const startSetup = (backend: Extract<BackendMode, 'extension' | 'local' | 'cloud'>) => {
    update({ browserEnabled: true, browserBackend: backend });
    setActiveTab(backend);
  };

  const backendPanel = (
    <div
      className={cn(
        'flex flex-col gap-5 transition-opacity',
        !form.browserEnabled && 'pointer-events-none opacity-40',
      )}
      aria-hidden={!form.browserEnabled}
    >
      {activeTab === 'extension' ? (
        <SettingsFormSection>
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
        </SettingsFormSection>
      ) : null}

      {activeTab === 'local' ? (
        <SettingsFormSection>
          <LocalCard
            embedded
            m={a}
            doctor={doctor.playwright}
            refetch={doctor.refetchPlaywright}
            applyDoctor={doctor.applyPlaywrightDoctor}
            installStream={playwrightInstall}
          />
        </SettingsFormSection>
      ) : null}

      {activeTab === 'cloakbrowser' ? (
        <SettingsFormSection>
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
        </SettingsFormSection>
      ) : null}

      {activeTab === 'cdp' ? (
        <SettingsFormSection>
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
        </SettingsFormSection>
      ) : null}

      {activeTab === 'cloud' ? (
        <SettingsFormSection>
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
        </SettingsFormSection>
      ) : null}
    </div>
  );

  if (activeTab === 'overview') {
    return (
      <div className="flex flex-col gap-5">
        {!form.browserEnabled ? <BrowserSetupGuide m={a} onStart={startSetup} /> : null}

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
              <>
                <BrowserStatusStrip
                  m={a}
                  backendName={backendName}
                  status={stripStatus.status}
                  statusLabel={stripStatus.statusLabel}
                />
                <div
                  id={browserFocusElementId('connection')}
                  className={cn(
                    'scroll-mt-24 transition-opacity',
                    !form.browserEnabled && 'pointer-events-none opacity-40',
                  )}
                >
                  <BackendModeList
                    m={a}
                    value={form.browserBackend}
                    onChange={(next) => update({ browserBackend: next })}
                    options={modeOptions}
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-fg-muted">{a.browserDisabledHint}</p>
            )}
          </div>
        </SettingsFormSection>
      </div>
    );
  }

  if (activeTab === 'behavior') {
    return (
      <div
        className={cn(
          'transition-opacity',
          !form.browserEnabled && 'pointer-events-none opacity-40',
        )}
        aria-hidden={!form.browserEnabled}
      >
        <BrowserBehaviorSections a={a} form={form} update={update} />
      </div>
    );
  }

  if (isBrowserBackendTab(activeTab)) {
    return backendPanel;
  }

  return null;
}
