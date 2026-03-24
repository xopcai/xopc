import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';

export function LanguageToggle() {
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);

  return (
    <div
      className="inline-flex rounded-md border border-edge bg-surface-panel p-0.5"
      role="group"
      aria-label="Language"
    >
      {(['en', 'zh'] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => setLanguage(lang)}
          className={cn(
            'rounded-sm px-2 py-1 text-xs font-medium text-fg-subtle hover:text-fg',
            language === lang && 'bg-surface-active text-fg',
          )}
        >
          {lang === 'en' ? 'EN' : '中文'}
        </button>
      ))}
    </div>
  );
}
