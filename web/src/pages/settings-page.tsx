import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, useParams } from 'react-router-dom';

import { messages } from '@/i18n/messages';
import {
  loadAppManagementSettingsPanel,
  loadAppearanceSettingsPanel,
  loadDreamingSettingsPanel,
  loadGatewaySettingsPanel,
  loadGoalsSettingsPanel,
  loadHeartbeatSettingsPanel,
  loadKeyboardShortcutsSettingsPanel,
  loadCapabilityPresetsSettingsPanel,
  loadModelsHubPanel,
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
  'app-management',
  'credentials',
  'capability-presets',
  'gateway',
  'heartbeat',
  'tunnel',
  'remote-access',
  'shares',
  'goals',
  'dreams',
];

const SetupStatusPanel = lazy(() => loadSetupStatusPanel().then((m) => ({ default: m.SetupStatusPanel })));
const AppearanceSettingsPanel = lazy(() =>
  loadAppearanceSettingsPanel().then((m) => ({ default: m.AppearanceSettingsPanel })),
);
const KeyboardShortcutsSettingsPanel = lazy(() =>
  loadKeyboardShortcutsSettingsPanel().then((m) => ({ default: m.KeyboardShortcutsSettingsPanel })),
);
const SystemSettingsPanel = lazy(() => loadSystemSettingsPanel().then((m) => ({ default: m.SystemSettingsPanel })));
const AppManagementSettingsPanel = lazy(() =>
  loadAppManagementSettingsPanel().then((m) => ({ default: m.AppManagementSettingsPanel })),
);
const ModelsHubPanel = lazy(() => loadModelsHubPanel().then((m) => ({ default: m.ModelsHubPanel })));
const GatewaySettingsPanel = lazy(() =>
  loadGatewaySettingsPanel().then((m) => ({ default: m.GatewaySettingsPanel })),
);
const HeartbeatSettingsPanel = lazy(() =>
  loadHeartbeatSettingsPanel().then((m) => ({ default: m.HeartbeatSettingsPanel })),
);
const RemoteAccessHub = lazy(() => loadRemoteAccessHub().then((m) => ({ default: m.RemoteAccessHub })));
const SharesSettingsPanel = lazy(() => loadSharesSettingsPanel().then((m) => ({ default: m.SharesSettingsPanel })));
const DreamingSettingsPanel = lazy(() =>
  loadDreamingSettingsPanel().then((m) => ({ default: m.DreamingSettingsPanel })),
);
const GoalsSettingsPanel = lazy(() => loadGoalsSettingsPanel().then((m) => ({ default: m.GoalsSettingsPanel })));
const CapabilityPresetsSettingsPanel = lazy(() =>
  loadCapabilityPresetsSettingsPanel().then((m) => ({ default: m.CapabilityPresetsSettingsPanel })),
);

function SettingsSectionFallback() {
  return (
    <div className="mx-auto w-full max-w-app-main flex-1 px-4 py-8" aria-busy>
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

  if (section === 'agent' || section === 'agents') {
    return <Navigate to="/agents" replace />;
  }

  if (!section || !SECTIONS.includes(section as SettingsSectionId)) {
    return <Navigate to="/settings/overview" replace />;
  }

  if (section === 'tunnel') {
    return <Navigate to="/settings/remote-access" replace />;
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

  if (id === 'app-management') {
    return renderLazySection(AppManagementSettingsPanel);
  }

  if (id === 'credentials') {
    return renderLazySection(ModelsHubPanel);
  }

  if (id === 'capability-presets') {
    return renderLazySection(CapabilityPresetsSettingsPanel);
  }

  if (id === 'gateway') {
    return renderLazySection(GatewaySettingsPanel);
  }

  if (id === 'heartbeat') {
    return renderLazySection(HeartbeatSettingsPanel);
  }

  if (id === 'tunnel' || id === 'remote-access') {
    return renderLazySection(RemoteAccessHub);
  }

  if (id === 'shares') {
    return renderLazySection(SharesSettingsPanel);
  }

  if (id === 'dreams') {
    return renderLazySection(DreamingSettingsPanel);
  }

  if (id === 'goals') {
    return renderLazySection(GoalsSettingsPanel);
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
      <h1 className="text-lg font-semibold text-fg">{title}</h1>
      <p className="text-sm text-fg-muted">{m.settingsPage.comingSoon.replace('{{title}}', title)}</p>
    </div>
  );
}
