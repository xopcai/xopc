import { AppManagementSection } from '@/features/settings/app-management-section';
import { settingsFormSectionClassName } from '@/features/settings/settings-form-section.utils';
import { isElectron } from '@/lib/electron-env';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function AppManagementSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.systemSettings;
  const app = t.appManagement;

  const api = typeof window !== 'undefined' ? window.electronAPI?.system : undefined;

  if (!isElectron() || !api) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <h1 className="text-lg font-semibold text-fg">{app.title}</h1>
        <div className={settingsFormSectionClassName()}>
          <p className="text-sm font-medium text-fg">{t.desktopOnlyTitle}</p>
          <p className="mt-1 text-sm text-fg-muted">{t.desktopOnlyBody}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-lg font-semibold text-fg">{app.title}</h1>
      </div>
      <AppManagementSection api={api} messages={app} embedded={false} />
    </div>
  );
}
