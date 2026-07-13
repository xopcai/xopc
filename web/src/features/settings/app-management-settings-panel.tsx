import { AppManagementSection } from '@/features/settings/app-management-section';
import { MigrationStatusCard } from '@/features/settings/migration-status-card';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { settingsFormSectionClassName } from '@/features/settings/settings-form-section.utils';
import { isElectron } from '@/lib/electron-env';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function AppManagementSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.systemSettings;
  const app = t.desktopApp;

  const api = typeof window !== 'undefined' ? window.electronAPI?.system : undefined;

  if (!isElectron() || !api) {
    return (
      <SettingsPageFrame gap="gap-3">
        <SettingsPageHeader title={app.title} />
        <MigrationStatusCard messages={app.migrations} />
        <div className={settingsFormSectionClassName()}>
          <p className="text-sm font-medium text-fg">{t.desktopOnlyTitle}</p>
          <p className="mt-1 text-sm text-fg-muted">{t.desktopOnlyBody}</p>
        </div>
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame gap="gap-6">
      <SettingsPageHeader title={app.title} />
      <MigrationStatusCard messages={app.migrations} />
      <AppManagementSection api={api} messages={app} embedded={false} />
    </SettingsPageFrame>
  );
}
