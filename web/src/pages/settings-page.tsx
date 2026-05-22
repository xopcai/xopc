import { Navigate, useParams } from 'react-router-dom';

import {
  AgentBrowserDefaultsPage,
  AgentChatDefaultsPage,
  AgentRuntimeDefaultsPage,
  AgentSystemPromptDefaultsPage,
  AgentToolsDefaultsPage,
  AgentWorkspaceDefaultsPage,
} from '@/features/settings/agents';
import { AppearanceSettingsPanel } from '@/features/settings/appearance-settings';
import { DreamingSettingsPanel } from '@/features/settings/dreaming-settings';
import { GatewaySettingsPanel } from '@/features/settings/gateway-settings';
import { HeartbeatSettingsPanel } from '@/features/settings/heartbeat-settings';
import { TunnelSettingsPanel } from '@/features/tunnel/tunnel-settings';
import { SharesSettingsPanel } from '@/features/shares/shares-settings';
import { ImageModelsSettingsPanel } from '@/features/settings/image-models-settings';
import { ModelsSettingsPanel } from '@/features/settings/models-settings';
import { ProvidersSettingsPanel } from '@/features/settings/providers-settings';
import { SystemSettingsPanel } from '@/features/settings/system-settings-panel';
import { VoiceSettingsPanel } from '@/features/settings/voice-settings';
import { WebSearchSettingsPanel } from '@/features/settings/web-search-settings';
import { McpSettingsPanel } from '@/features/settings/mcp/mcp-settings';
import { messages } from '@/i18n/messages';
import type { SettingsSectionId } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';

const SECTIONS: SettingsSectionId[] = [
  'appearance',
  'system',
  'agent-chat',
  'agent-workspace',
  'agent-browser',
  'agent-runtime',
  'agent-tools',
  'agent-system-prompt',
  'providers',
  'models',
  'image-models',
  'voice',
  'gateway',
  'heartbeat',
  'tunnel',
  'shares',
  'search',
  'mcp',
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
    return <Navigate to="/settings/appearance" replace />;
  }

  const id = section as SettingsSectionId;
  const title = m.settingsSections[id];

  if (id === 'appearance') {
    return <AppearanceSettingsPanel />;
  }

  if (id === 'system') {
    return <SystemSettingsPanel />;
  }

  if (id === 'agent-chat') {
    return <AgentChatDefaultsPage />;
  }

  if (id === 'agent-workspace') {
    return <AgentWorkspaceDefaultsPage />;
  }

  if (id === 'agent-browser') {
    return <AgentBrowserDefaultsPage />;
  }

  if (id === 'agent-runtime') {
    return <AgentRuntimeDefaultsPage />;
  }

  if (id === 'agent-tools') {
    return <AgentToolsDefaultsPage />;
  }

  if (id === 'agent-system-prompt') {
    return <AgentSystemPromptDefaultsPage />;
  }

  if (id === 'providers') {
    return <ProvidersSettingsPanel />;
  }

  if (id === 'models') {
    return <ModelsSettingsPanel />;
  }

  if (id === 'image-models') {
    return <ImageModelsSettingsPanel />;
  }

  if (id === 'voice') {
    return <VoiceSettingsPanel />;
  }

  if (id === 'gateway') {
    return <GatewaySettingsPanel />;
  }

  if (id === 'heartbeat') {
    return <HeartbeatSettingsPanel />;
  }

  if (id === 'tunnel') {
    return <TunnelSettingsPanel />;
  }

  if (id === 'shares') {
    return <SharesSettingsPanel />;
  }

  if (id === 'search') {
    return <WebSearchSettingsPanel />;
  }

  if (id === 'mcp') {
    return <McpSettingsPanel />;
  }

  if (id === 'dreams') {
    return <DreamingSettingsPanel />;
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
      <h1 className="text-lg font-semibold text-fg">{title}</h1>
      <p className="text-sm text-fg-muted">
        {language === 'zh' ? `设置 · ${title}（即将推出）。` : `Settings · ${title} (coming soon).`}
      </p>
    </div>
  );
}
