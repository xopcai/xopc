import { Bell } from 'lucide-react';
import { useState } from 'react';

import {
  enableBrowserNotifications,
  showBrowserTestNotification,
} from '@/features/notifications/browser-notification-delivery';
import {
  getBrowserNotificationPreferences,
  setBrowserNotificationPreferences,
} from '@/features/notifications/browser-notification-preferences';
import { SettingsFormSection } from '@/features/settings/settings-form-section';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function BrowserNotificationSettings() {
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).systemSettings.browserNotify;
  const [preferences, setPreferences] = useState(getBrowserNotificationPreferences);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleEnabled = async (enabled: boolean) => {
    if (!enabled) {
      setPreferences(setBrowserNotificationPreferences({ enabled: false }));
      setFeedback(null);
      return;
    }
    setBusy(true);
    try {
      const permission = await enableBrowserNotifications();
      if (permission !== 'granted') {
        setFeedback(permission === 'unsupported' ? copy.unsupported : copy.denied);
        return;
      }
      const next = setBrowserNotificationPreferences({ enabled: true });
      setPreferences(next);
      setFeedback(await showBrowserTestNotification(copy.testTitle, copy.testBody)
        ? copy.testShown
        : copy.failed);
    } finally {
      setBusy(false);
    }
  };

  const patch = (next: Partial<typeof preferences>) => {
    setPreferences(setBrowserNotificationPreferences(next));
  };

  return (
    <SettingsPageFrame gap="gap-6">
      <SettingsPageHeader title={copy.pageTitle} />
      <SettingsFormSection>
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-fg">
          <Bell className="size-4 text-accent" strokeWidth={1.75} />
          {copy.title}
        </div>
        <p className="mb-4 text-sm text-fg-muted">{copy.description}</p>
        <div className="space-y-2">
          {([
            ['enabled', copy.enabled, copy.enabledDesc],
            ['completed', copy.completed, copy.completedDesc],
            ['failed', copy.failedRuns, copy.failedRunsDesc],
          ] as const).map(([key, label, description]) => (
            <label key={key} className="flex items-center justify-between gap-3 rounded-xl bg-surface-hover/50 px-3 py-2.5 dark:bg-surface-hover/35">
              <span>
                <span className="block text-sm font-medium text-fg">{label}</span>
                <span className="block text-xs text-fg-muted">{description}</span>
              </span>
              <input
                type="checkbox"
                className="ui-checkbox"
                disabled={busy || (key !== 'enabled' && !preferences.enabled)}
                checked={preferences[key]}
                onChange={(event) => {
                  if (key === 'enabled') void toggleEnabled(event.target.checked);
                  else patch({ [key]: event.target.checked });
                }}
              />
            </label>
          ))}
        </div>
        {feedback ? <p className="mt-3 text-sm text-fg-muted" role="status">{feedback}</p> : null}
        <p className="mt-4 text-xs text-fg-muted">{copy.limitation}</p>
      </SettingsFormSection>
    </SettingsPageFrame>
  );
}
