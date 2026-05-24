import { PreferenceSelectFields } from '@/components/shell/preference-select-fields';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';
import { type ColorScheme, useThemeStore } from '@/stores/theme-store';

function preferenceCardClassName() {
  return cn('rounded-xl border border-edge-subtle bg-surface-base px-4 py-1 sm:px-5');
}

/**
 * Mini chrome preview per globals.css tokens — left: light, right: dark for the same palette.
 */
const SCHEME_PREVIEW: Record<
  ColorScheme,
  { light: { canvas: string; panel: string; accent: string; fg: string; muted: string }; dark: { canvas: string; panel: string; accent: string; fg: string; muted: string } }
> = {
  default: {
    light: {
      canvas: '#f5f5f7',
      panel: '#ffffff',
      accent: '#2563eb',
      fg: '#1d1d1f',
      muted: '#d2d2d7',
    },
    dark: {
      canvas: '#1c1c1e',
      panel: '#2c2c2e',
      accent: '#3b82f6',
      fg: '#f5f5f7',
      muted: '#48484a',
    },
  },
  emerald: {
    light: {
      canvas: '#f0fdf4',
      panel: '#ffffff',
      accent: '#059669',
      fg: '#052e16',
      muted: '#86efac',
    },
    dark: {
      canvas: '#000000',
      panel: '#0a0a0a',
      accent: '#10b981',
      fg: '#d1fae5',
      muted: '#134e2a',
    },
  },
  mono: {
    light: {
      canvas: '#ffffff',
      panel: '#f5f5f5',
      accent: '#111111',
      fg: '#111111',
      muted: '#e5e7eb',
    },
    dark: {
      canvas: '#101010',
      panel: '#1a1a1a',
      accent: '#737373',
      fg: '#fafafa',
      muted: '#333333',
    },
  },
  clay: {
    light: {
      canvas: '#fffaf0',
      panel: '#ffffff',
      accent: '#1a3a3a',
      fg: '#0a0a0a',
      muted: '#e5e5e5',
    },
    dark: {
      canvas: '#0a1a1a',
      panel: '#1a2a2a',
      accent: '#ffb084',
      fg: '#fffaf0',
      muted: '#2a3a3a',
    },
  },
};

function SchemePreviewHalf({
  canvas,
  panel,
  accent,
  fg,
  muted,
}: {
  canvas: string;
  panel: string;
  accent: string;
  fg: string;
  muted: string;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center gap-1 p-1.5" style={{ backgroundColor: canvas }}>
      <div
        className="flex flex-col gap-0.5 rounded-sm border p-1"
        style={{ backgroundColor: panel, borderColor: muted }}
      >
        <div className="flex items-center gap-1">
          <div className="size-1 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
          <div className="h-1 min-w-0 flex-1 rounded-full" style={{ backgroundColor: fg, opacity: 0.85 }} />
        </div>
        <div className="h-1 w-2/3 max-w-[70%] rounded-full" style={{ backgroundColor: muted }} />
        <div className="size-1/2 max-w-[55%] rounded-full" style={{ backgroundColor: muted }} />
      </div>
    </div>
  );
}

/** Side-by-side light (left) and dark (right) samples for one color scheme. */
function SchemePreviewSwatch({ scheme }: { scheme: ColorScheme }) {
  const { light, dark } = SCHEME_PREVIEW[scheme];
  return (
    <div className="flex h-11 w-full overflow-hidden rounded-md border border-edge-subtle">
      <SchemePreviewHalf {...light} />
      <div className="w-px shrink-0 bg-black/12 dark:bg-white/12" aria-hidden />
      <SchemePreviewHalf {...dark} />
    </div>
  );
}

const COLOR_SCHEME_OPTIONS: {
  value: ColorScheme;
  labelKey:
    | 'colorSchemeDefault'
    | 'colorSchemeLightGreen'
    | 'colorSchemeModernMono'
    | 'colorSchemeClay';
}[] = [
  { value: 'default', labelKey: 'colorSchemeDefault' },
  { value: 'emerald', labelKey: 'colorSchemeLightGreen' },
  { value: 'mono', labelKey: 'colorSchemeModernMono' },
  { value: 'clay', labelKey: 'colorSchemeClay' },
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {COLOR_SCHEME_OPTIONS.map(({ value, labelKey }) => {
          const isSelected = colorScheme === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setColorScheme(value)}
              className={cn(
                'flex flex-col gap-2 rounded-xl border-2 p-2.5 text-left transition-[border-color,box-shadow,transform] duration-150',
                interaction.pressCard,
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
