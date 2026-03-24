import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function SessionsPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-8">
      <h1 className="text-lg font-semibold text-fg">{m.nav.sessions}</h1>
      <p className="text-sm text-fg-muted">
        {language === 'zh' ? '会话管理（占位）。' : 'Session manager (placeholder).'}
      </p>
    </div>
  );
}
