import { Navigate, useParams } from 'react-router-dom';

import { AgentSettingsPanel } from '@/features/settings/agent-settings';
import { AppearanceSettingsPanel } from '@/features/settings/appearance-settings';
import { ChannelsSettingsPanel } from '@/features/settings/channels-settings';
import { GatewaySettingsPanel } from '@/features/settings/gateway-settings';
import { ModelsSettingsPanel } from '@/features/settings/models-settings';
import { VoiceSettingsPanel } from '@/features/settings/voice-settings';
import { ProvidersSettingsPanel } from '@/features/settings/providers-settings';
import { messages } from '@/i18n/messages';
import type { SettingsSectionId } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';

const SECTIONS: SettingsSectionId[] = [
  'appearance',
  'agent',
  'providers',
  'models',
  'channels',
  'voice',
  'gateway',
];

export function SettingsPage() {
  const { section } = useParams();
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  if (!section || !SECTIONS.includes(section as SettingsSectionId)) {
    return <Navigate to="/settings/appearance" replace />;
  }

  const id = section as SettingsSectionId;
  const title = m.settingsSections[id];

  if (id === 'appearance') {
    return <AppearanceSettingsPanel />;
  }

  if (id === 'agent') {
    return <AgentSettingsPanel />;
  }

  if (id === 'providers') {
    return <ProvidersSettingsPanel />;
  }

  if (id === 'models') {
    return <ModelsSettingsPanel />;
  }

  if (id === 'channels') {
    return <ChannelsSettingsPanel />;
  }

  if (id === 'voice') {
    return <VoiceSettingsPanel />;
  }

  if (id === 'gateway') {
    return <GatewaySettingsPanel />;
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
