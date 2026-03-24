import { Navigate, useParams } from 'react-router-dom';

import { messages } from '@/i18n/messages';
import type { SettingsSectionId } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';

const SECTIONS: SettingsSectionId[] = [
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
    return <Navigate to="/settings/agent" replace />;
  }

  const id = section as SettingsSectionId;
  const title = m.settingsSections[id];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-8">
      <h1 className="text-lg font-semibold text-fg">{title}</h1>
      <p className="text-sm text-fg-muted">
        {language === 'zh' ? `设置 · ${title}（占位）。` : `Settings · ${title} (placeholder).`}
      </p>
    </div>
  );
}
