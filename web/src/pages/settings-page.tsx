import { Navigate, useParams } from 'react-router-dom';

import {
  AgentBrowserSettingsPage,
  AgentDefaultsTabbedPage,
} from '@/features/settings/agents';
import { SetupStatusPanel } from '@/features/settings/setup-checklist/setup-status-panel';
import { ModelsHubPanel } from '@/features/settings/models-hub/models-hub-panel';
import { AppearanceSettingsPanel } from '@/features/settings/appearance-settings';
import { KeyboardShortcutsSettingsPanel } from '@/features/settings/keyboard-shortcuts-settings';
import { DreamingSettingsPanel } from '@/features/settings/dreaming-settings';
import { GoalsSettingsPanel } from '@/features/settings/goals-settings';
import { GatewaySettingsPanel } from '@/features/settings/gateway-settings';
import { HeartbeatSettingsPanel } from '@/features/settings/heartbeat-settings';
import { RemoteAccessHub } from '@/features/remote-access/remote-access-hub';
import { SharesSettingsPanel } from '@/features/shares/shares-settings';
import { AppManagementSettingsPanel } from '@/features/settings/app-management-settings-panel';
import { SystemSettingsPanel } from '@/features/settings/system-settings-panel';
import { McpSettingsPanel } from '@/features/settings/mcp/mcp-settings';
import { messages } from '@/i18n/messages';
import type { SettingsSectionId } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';

const SECTIONS: SettingsSectionId[] = [
  'overview',
  'appearance',
  'keyboard-shortcuts',
  'system',
  'app-management',
  'agent-defaults',
  'agent-browser',
  'agent-mcp',
  'credentials',
  'gateway',
  'heartbeat',
  'tunnel',
  'remote-access',
  'shares',
  'goals',
  'dreams',
];

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
    return <SetupStatusPanel />;
  }

  const title = m.settingsSections[id];

  if (id === 'agent-defaults') {
    return <AgentDefaultsTabbedPage />;
  }

  if (id === 'agent-browser') {
    return <AgentBrowserSettingsPage />;
  }

  if (id === 'agent-mcp') {
    return <McpSettingsPanel />;
  }

  if (id === 'appearance') {
    return <AppearanceSettingsPanel />;
  }

  if (id === 'keyboard-shortcuts') {
    return <KeyboardShortcutsSettingsPanel />;
  }

  if (id === 'system') {
    return <SystemSettingsPanel />;
  }

  if (id === 'app-management') {
    return <AppManagementSettingsPanel />;
  }

  if (id === 'credentials') {
    return <ModelsHubPanel />;
  }

  if (id === 'gateway') {
    return <GatewaySettingsPanel />;
  }

  if (id === 'heartbeat') {
    return <HeartbeatSettingsPanel />;
  }

  if (id === 'tunnel' || id === 'remote-access') {
    return <RemoteAccessHub />;
  }

  if (id === 'shares') {
    return <SharesSettingsPanel />;
  }

  if (id === 'dreams') {
    return <DreamingSettingsPanel />;
  }

  if (id === 'goals') {
    return <GoalsSettingsPanel />;
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
      <h1 className="text-lg font-semibold text-fg">{title}</h1>
      <p className="text-sm text-fg-muted">{m.settingsPage.comingSoon.replace('{{title}}', title)}</p>
    </div>
  );
}
