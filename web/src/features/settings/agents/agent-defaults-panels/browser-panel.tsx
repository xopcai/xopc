import { Cloud, Globe, MonitorPlay, Puzzle, ShieldCheck, Webhook } from 'lucide-react';
import { useMemo } from 'react';

import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';

import { AgentDefaultsField } from '../agent-defaults-field';
import type { AgentDefaultsPanelProps } from '../agent-defaults-panel-props';
import { inputClassName, selectClassName } from '../defaults-field-styles';

import type { ModeStatusKind } from './browser/backend-mode-card';
import { BackendModePicker, type BackendModeOption } from './browser/backend-mode-picker';
import { CdpCard } from './browser/cdp-card';
import { CloakCard } from './browser/cloak-card';
import { CloudCard } from './browser/cloud-card';
import { ExtensionCard } from './browser/extension-card';
import { LocalCard } from './browser/local-card';
import { useBrowserDoctor } from './browser/use-browser-doctor';

export function AgentDefaultsBrowserPanel(props: AgentDefaultsPanelProps) {
  const { a, form, update } = props;

  const doctor = useBrowserDoctor({
    cacheDir: form.browserCloakCacheDir,
    binaryPath: form.browserCloakBinaryPath,
    extensionEnabled: form.browserEnabled,
    extensionHost: form.browserExtensionHost,
    extensionPort: form.browserExtensionPort,
  });

  const localStatus = doctorStatus(doctor.playwright);
  const cloakStatus = doctorStatus(doctor.cloak);
  const extensionStatus = extensionDoctorStatus(doctor.extension);
  const extensionStatusLabel = extensionStatusLabelFor(doctor.extension, a);

  const modeOptions = useMemo<BackendModeOption[]>(
    () => [
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
      {
        value: 'extension',
        icon: Puzzle,
        name: a.browserBackendExtension,
        tagline: a.browserModeExtTagline,
        status: extensionStatus,
        statusLabel: extensionStatusLabel,
      },
    ],
    [a, cloakStatus, extensionStatus, extensionStatusLabel, localStatus],
  );

  const selectedOption = modeOptions.find((o) => o.value === form.browserBackend) ?? modeOptions[0];
  const SelectedIcon = selectedOption.icon;

  return (
    <div className="flex flex-col gap-5">
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Globe} title={a.cardBrowserTitle} subtitle={a.cardBrowserSubtitle} />
        <div className="flex flex-col gap-5">
          {/* Global toggles */}
          <div className="grid gap-5 sm:grid-cols-2">
            <AgentDefaultsField label={a.label.browserEnabled} description={a.desc.browserEnabled}>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 rounded border-edge"
                  checked={form.browserEnabled}
                  onChange={(e) => update({ browserEnabled: e.target.checked })}
                />
                <span>{a.browserEnabledOn}</span>
              </label>
            </AgentDefaultsField>
            <AgentDefaultsField label={a.label.browserHeadless} description={a.desc.browserHeadless}>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 rounded border-edge"
                  checked={form.browserHeadless}
                  onChange={(e) => update({ browserHeadless: e.target.checked })}
                />
                <span>{a.browserHeadlessOn}</span>
              </label>
            </AgentDefaultsField>
            <AgentDefaultsField label={a.label.browserAllowPrivateUrls} description={a.desc.browserAllowPrivateUrls}>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 rounded border-edge"
                  checked={form.browserAllowPrivateUrls}
                  onChange={(e) => update({ browserAllowPrivateUrls: e.target.checked })}
                />
                <span>{a.browserAllowPrivateOn}</span>
              </label>
            </AgentDefaultsField>
            <AgentDefaultsField label={a.label.browserCommandTimeout} description={a.desc.browserCommandTimeout}>
              <input
                type="number"
                className={inputClassName()}
                min={5}
                value={form.browserCommandTimeout ?? ''}
                placeholder="30"
                onChange={(e) => {
                  const v = e.target.value;
                  update({ browserCommandTimeout: v === '' ? undefined : Number.parseInt(v, 10) });
                }}
              />
            </AgentDefaultsField>
          </div>

          {/* Backend mode picker — 5 cards, selected highlighted */}
          <BackendModePicker
            m={a}
            value={form.browserBackend}
            onChange={(next) => update({ browserBackend: next })}
            options={modeOptions}
          />

          {/* Section header makes it unambiguous what's being configured below */}
          <div className="flex items-center gap-3 border-b border-edge pb-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <SelectedIcon className="size-4" strokeWidth={1.75} />
            </div>
            <div className="flex flex-col">
              <div className="text-sm font-semibold text-fg">
                {a.browserConfiguringHeader.replace('{{mode}}', selectedOption.name)}
              </div>
              <div className="text-xs text-fg-muted">{selectedOption.tagline}</div>
            </div>
          </div>

          {/* Selected mode card */}
          {form.browserBackend === 'local' ? (
            <LocalCard m={a} doctor={doctor.playwright} refetch={doctor.refetchPlaywright} />
          ) : null}
          {form.browserBackend === 'cloakbrowser' ? (
            <CloakCard
              m={a}
              doctor={doctor.cloak}
              refetch={doctor.refetchCloak}
              form={{
                cacheDir: form.browserCloakCacheDir,
                binaryPath: form.browserCloakBinaryPath,
                keepOpen: form.browserCloakKeepOpen,
                temporaryProfile: form.browserCloakTemporaryProfile,
                humanize: form.browserHumanize,
                humanPreset: form.browserHumanPreset,
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
                })
              }
            />
          ) : null}
          {form.browserBackend === 'cdp' ? (
            <CdpCard
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
              m={a}
              probe={doctor.extension}
              form={{ port: form.browserExtensionPort, host: form.browserExtensionHost }}
              onChange={(patch) =>
                update({
                  ...(patch.port !== undefined ? { browserExtensionPort: patch.port } : {}),
                  ...(patch.host !== undefined ? { browserExtensionHost: patch.host } : {}),
                })
              }
              startBridge={doctor.startExtensionBridge}
              stopBridge={doctor.stopExtensionBridge}
            />
          ) : null}

          {/* Dialog policy (shared across modes) */}
          <div className="grid gap-5 sm:grid-cols-2">
            <AgentDefaultsField label={a.label.browserDialogPolicy} description={a.desc.browserDialogPolicy}>
              <select
                className={selectClassName()}
                value={form.browserDialogPolicy}
                onChange={(e) =>
                  update({
                    browserDialogPolicy: e.target.value as 'must_respond' | 'auto_dismiss' | 'auto_accept',
                  })
                }
              >
                <option value="must_respond">{a.browserDialogPolicyMustRespond}</option>
                <option value="auto_dismiss">{a.browserDialogPolicyAutoDismiss}</option>
                <option value="auto_accept">{a.browserDialogPolicyAutoAccept}</option>
              </select>
            </AgentDefaultsField>
            <AgentDefaultsField label={a.label.browserDialogTimeout} description={a.desc.browserDialogTimeout}>
              <input
                type="number"
                className={inputClassName()}
                min={1}
                value={form.browserDialogTimeout ?? ''}
                placeholder="300"
                onChange={(e) => {
                  const v = e.target.value;
                  update({ browserDialogTimeout: v === '' ? undefined : Number.parseInt(v, 10) });
                }}
              />
            </AgentDefaultsField>
          </div>
        </div>
      </SettingsFormSection>
    </div>
  );
}

function doctorStatus<T extends { installed: boolean }>(
  d: { kind: 'idle' } | { kind: 'loading' } | { kind: 'ok'; data: T } | { kind: 'error'; message: string },
): ModeStatusKind | undefined {
  if (d.kind === 'loading') return 'checking';
  if (d.kind === 'error') return 'error';
  if (d.kind === 'ok') return d.data.installed ? 'ready' : 'not_installed';
  return undefined;
}

function statusLabelFor(
  status: ModeStatusKind | undefined,
  a: AgentDefaultsPanelProps['a'],
): string | undefined {
  if (!status) return undefined;
  return {
    ready: a.browserStatusReady,
    not_installed: a.browserStatusNotInstalled,
    checking: a.browserStatusChecking,
    unknown: a.browserStatusUnknown,
    error: a.browserStatusError,
  }[status];
}

function extensionDoctorStatus(
  d: ReturnType<typeof useBrowserDoctor>['extension'],
): ModeStatusKind | undefined {
  if (d.kind === 'idle') return undefined;
  if (d.kind === 'loading') return 'checking';
  if (d.kind === 'error') return 'error';
  // ok: connected → ready; running but not connected → "not_installed" surrogate (waiting)
  if (d.data.connected) return 'ready';
  if (d.data.running) return 'not_installed';
  return 'not_installed';
}

function extensionStatusLabelFor(
  d: ReturnType<typeof useBrowserDoctor>['extension'],
  a: AgentDefaultsPanelProps['a'],
): string | undefined {
  if (d.kind === 'idle') return undefined;
  if (d.kind === 'loading') return a.browserStatusChecking;
  if (d.kind === 'error') return a.browserStatusError;
  if (d.data.connected) return a.browserExtensionConnected;
  if (d.data.running) return a.browserExtensionWaiting;
  return a.browserExtensionServerOff;
}
