import { GoalsConfigSection } from '@/features/settings/goals-config-section';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

export function GoalsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).goalsSettingsPage;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6 sm:px-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{t.title}</h1>
        <p className="max-w-2xl text-sm text-fg-muted">{t.subtitle}</p>
      </header>
      <GoalsConfigSection hasToken={hasToken} />
    </div>
  );
}
