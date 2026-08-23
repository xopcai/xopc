import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, useParams } from 'react-router-dom';

import { messages } from '@/i18n/messages';
import {
  loadAppManagementSettingsPanel,
  loadAppearanceSettingsPanel,
  loadDesktopPetSettingsPanel,
  loadGatewaySettingsPanel,
  loadRuntimeToolsSettingsPanel,
  loadEndpointToolsManagementSettings,
  loadHeartbeatSettingsPanel,
  loadKeyboardShortcutsSettingsPanel,
  loadCapabilityPresetsSettingsPanel,
  loadRemoteAccessHub,
  loadSetupStatusPanel,
  loadSharesSettingsPanel,
  loadSystemSettingsPanel,
} from '@/lib/route-preload';
import type { SettingsSectionId } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';

const SECTIONS: SettingsSectionId[] = [
  'overview',
  'appearance',
  'keyboard-shortcuts',
  'system',
  'desktop-pet',
  'desktop-app',
  'capability-presets',
  'gateway',
  'runtimes',
  'devices',
  'heartbeat',
  'remote-access',
  'shares',
];

const SetupStatusPanel = lazy(() => loadSetupStatusPanel().then((m) => ({ default: m.SetupStatusPanel })));
const AppearanceSettingsPanel = lazy(() =>
  loadAppearanceSettingsPanel().then((m) => ({ default: m.AppearanceSettingsPanel })),
);
const KeyboardShortcutsSettingsPanel = lazy(() =>
  loadKeyboardShortcutsSettingsPanel().then((m) => ({ default: m.KeyboardShortcutsSettingsPanel })),
);
const SystemSettingsPanel = lazy(() => loadSystemSettingsPanel().then((m) => ({ default: m.SystemSettingsPanel })));
const DesktopPetSettings = lazy(() => loadDesktopPetSettingsPanel().then((m) => ({ default: m.DesktopPetSettings })));
const AppManagementSettingsPanel = lazy(() =>
  loadAppManagementSettingsPanel().then((m) => ({ default: m.AppManagementSettingsPanel })),
);
const GatewaySettingsPanel = lazy(() =>
  loadGatewaySettingsPanel().then((m) => ({ default: m.GatewaySettingsPanel })),
);
const RuntimeToolsSettingsPanel = lazy(() =>
  loadRuntimeToolsSettingsPanel().then((m) => ({ default: m.RuntimeToolsSettingsPanel })),
);
const HeartbeatSettingsPanel = lazy(() =>
  loadHeartbeatSettingsPanel().then((m) => ({ default: m.HeartbeatSettingsPanel })),
);
const RemoteAccessHub = lazy(() => loadRemoteAccessHub().then((m) => ({ default: m.RemoteAccessHub })));
const SharesSettingsPanel = lazy(() => loadSharesSettingsPanel().then((m) => ({ default: m.SharesSettingsPanel })));
const CapabilityPresetsSettingsPanel = lazy(() =>
  loadCapabilityPresetsSettingsPanel().then((m) => ({ default: m.CapabilityPresetsSettingsPanel })),
);
const EndpointToolsManagementSettings = lazy(() =>
  loadEndpointToolsManagementSettings().then((m) => ({ default: m.EndpointToolsManagementSettings })),
);

function SettingsSectionFallback() {
  return (
    <div className="w-full flex-1 px-3 py-8 sm:px-5 xl:px-6" aria-busy>
      <div className="h-8 w-48 max-w-full animate-pulse rounded-md bg-surface-hover" />
      <div className="mt-6 h-36 animate-pulse rounded-xl bg-surface-hover" />
      <div className="mt-4 h-24 animate-pulse rounded-xl bg-surface-hover" />
    </div>
  );
}

function renderLazySection(Panel: ComponentType) {
  return (
    <Suspense fallback={<SettingsSectionFallback />}>
      <Panel />
    </Suspense>
  );
}

export function SettingsPage() {
  const { section } = useParams();
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  if (!section || !SECTIONS.includes(section as SettingsSectionId)) {
    return <Navigate to="/settings/overview" replace />;
  }

  const id = section as SettingsSectionId;

  if (id === 'overview') {
    return renderLazySection(SetupStatusPanel);
  }

  const title = m.settingsSections[id];

  if (id === 'appearance') {
    return renderLazySection(AppearanceSettingsPanel);
  }

  if (id === 'keyboard-shortcuts') {
    return renderLazySection(KeyboardShortcutsSettingsPanel);
  }

  if (id === 'system') {
    return renderLazySection(SystemSettingsPanel);
  }

  if (id === 'desktop-pet') {
    return renderLazySection(DesktopPetSettings);
  }

  if (id === 'desktop-app') {
    return renderLazySection(AppManagementSettingsPanel);
  }

  if (id === 'capability-presets') {
    return renderLazySection(CapabilityPresetsSettingsPanel);
  }

  if (id === 'gateway') {
    return renderLazySection(GatewaySettingsPanel);
  }

  if (id === 'runtimes') {
    return renderLazySection(RuntimeToolsSettingsPanel);
  }

  if (id === 'devices') {
    return renderLazySection(EndpointToolsManagementSettings);
  }

  if (id === 'heartbeat') {
    return renderLazySection(HeartbeatSettingsPanel);
  }

  if (id === 'remote-access') {
    return renderLazySection(RemoteAccessHub);
  }

  if (id === 'shares') {
    return renderLazySection(SharesSettingsPanel);
  }

  return (
    <div className="flex w-full flex-col gap-3 px-3 py-8 sm:px-5 xl:px-6">
      <h1 className="text-lg font-semibold text-fg">{title}</h1>
      <p className="text-sm text-fg-muted">{m.settingsPage.comingSoon.replace('{{title}}', title)}</p>
    </div>
  );
}
