import { PreferenceSelectFields } from '@/components/shell/preference-select-fields';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import { type ColorScheme, useThemeStore } from '@/stores/theme-store';

function preferenceCardClassName() {
  return cn('rounded-xl border border-edge-subtle bg-surface-base px-4 py-1 sm:px-5');
}

/** Mini preview swatch that shows what a color scheme looks like. */
function SchemePreviewSwatch({ scheme }: { scheme: ColorScheme }) {
  if (scheme === 'mono') {
    return (
      <div className="flex h-10 w-full overflow-hidden rounded-md border border-edge-subtle">
        <div className="flex flex-1 flex-col gap-1 bg-[#ffffff] p-1.5">
          <div className="h-1 w-8 rounded-full bg-[#111111]" />
          <div className="h-1 w-5 rounded-full bg-[#e5e7eb]" />
        </div>
        <div className="w-1.5 bg-[#111111]" />
        <div className="flex flex-1 flex-col gap-1 bg-[#f5f5f5] p-1.5">
          <div className="h-1 w-6 rounded-full bg-[#111111]" />
          <div className="h-1 w-9 rounded-full bg-[#6b7280]" />
          <div className="h-1 w-4 rounded-full bg-[#e5e7eb]" />
        </div>
      </div>
    );
  }

  if (scheme === 'emerald') {
    return (
      <div className="flex h-10 w-full overflow-hidden rounded-md border border-edge-subtle">
        <div className="flex flex-1 flex-col gap-1 bg-[#0a0a0a] p-1.5">
          <div className="h-1 w-8 rounded-full bg-[#134e2a]" />
          <div className="h-1 w-5 rounded-full bg-[#134e2a]" />
        </div>
        <div className="w-1.5 bg-[#10b981]" />
        <div className="flex flex-1 flex-col gap-1 bg-[#000000] p-1.5">
          <div className="h-1 w-6 rounded-full bg-[#34d399]" />
          <div className="h-1 w-9 rounded-full bg-[#065f46]" />
          <div className="h-1 w-4 rounded-full bg-[#065f46]" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-10 w-full overflow-hidden rounded-md border border-edge-subtle">
      <div className="flex flex-1 flex-col gap-1 bg-[#f5f5f7] p-1.5">
        <div className="h-1 w-8 rounded-full bg-[#d2d2d7]" />
        <div className="h-1 w-5 rounded-full bg-[#d2d2d7]" />
      </div>
      <div className="w-1.5 bg-[#2563eb]" />
      <div className="flex flex-1 flex-col gap-1 bg-[#ffffff] p-1.5">
        <div className="h-1 w-6 rounded-full bg-[#1d1d1f]" />
        <div className="h-1 w-9 rounded-full bg-[#d2d2d7]" />
        <div className="h-1 w-4 rounded-full bg-[#d2d2d7]" />
      </div>
    </div>
  );
}

const COLOR_SCHEME_OPTIONS: {
  value: ColorScheme;
  labelKey: 'colorSchemeDefault' | 'colorSchemeLightGreen' | 'colorSchemeModernMono';
}[] = [
  { value: 'default', labelKey: 'colorSchemeDefault' },
  { value: 'emerald', labelKey: 'colorSchemeLightGreen' },
  { value: 'mono', labelKey: 'colorSchemeModernMono' },
];

function ColorSchemeSelector() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const a = m.appearanceSettings;
  const colorScheme = useThemeStore((s) => s.colorScheme);
  const setColorScheme = useThemeStore((s) => s.setColorScheme);

  return (
    <div className="flex flex-col gap-2 border-b border-edge-subtle py-3.5 last:border-b-0 sm:py-4">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-fg">{a.colorSchemeTitle}</div>
        <p className="mt-0.5 text-xs text-fg-muted">{a.colorSchemeDescription}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {COLOR_SCHEME_OPTIONS.map(({ value, labelKey }) => {
          const isSelected = colorScheme === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setColorScheme(value)}
              className={cn(
                'flex flex-col gap-2 rounded-xl border-2 p-2.5 text-left transition-[border-color,box-shadow] duration-150',
                isSelected
                  ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)]'
                  : 'border-edge-subtle hover:border-edge',
              )}
            >
              <SchemePreviewSwatch scheme={value} />
              <span
                className={cn(
                  'text-xs font-medium leading-none',
                  isSelected ? 'text-accent-fg' : 'text-fg-muted',
                )}
              >
                {a[labelKey]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
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
        <ColorSchemeSelector />
      </section>
    </div>
  );
}
