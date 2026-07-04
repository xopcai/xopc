import { GoalsConfigSection } from '@/features/settings/goals-config-section';
import { SaveBarControls } from '@/features/settings/save-bar/save-bar-controls';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

export function GoalsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).goalsSettingsPage;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  return (
    <SettingsPageFrame gap="gap-4">
      <SettingsPageHeader title={t.title} subtitle={t.subtitle} />
      <SaveBarControls />
      <GoalsConfigSection hasToken={hasToken} />
    </SettingsPageFrame>
  );
}
