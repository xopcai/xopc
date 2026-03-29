import { PreferenceSelectFields } from '@/components/shell/preference-select-fields';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

function preferenceCardClassName() {
  return cn('rounded-xl border border-edge-subtle bg-surface-base px-4 py-1 sm:px-5');
}

export function AppearanceSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const a = m.appearanceSettings;

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{a.pageTitle}</h1>
        <p className="text-sm text-fg-muted">{a.subtitle}</p>
      </header>

      <section className={preferenceCardClassName()} aria-labelledby="pref-language-heading">
        <h2 id="pref-language-heading" className="sr-only">
          {a.languageTitle}
        </h2>
        <PreferenceSelectFields variant="page" sections={['language']} />
      </section>

      <section className={preferenceCardClassName()} aria-labelledby="pref-appearance-heading">
        <h2 id="pref-appearance-heading" className="sr-only">
          {a.themeTitle}
        </h2>
        <PreferenceSelectFields variant="page" sections={['theme', 'font']} />
      </section>
    </div>
  );
}
