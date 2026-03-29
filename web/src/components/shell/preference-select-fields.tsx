import type { StoredLanguage } from '@/lib/storage';
import { selectControlBaseClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { type FontScalePreference, useFontScaleStore } from '@/stores/font-scale-store';
import { type ThemePreference, useThemeStore } from '@/stores/theme-store';

type Variant = 'page' | 'sidebar';

export type PreferenceSection = 'language' | 'theme' | 'font';

const ALL_SECTIONS: readonly PreferenceSection[] = ['language', 'theme', 'font'];

export function PreferenceSelectFields({
  variant,
  sections = ALL_SECTIONS,
}: {
  variant: Variant;
  sections?: readonly PreferenceSection[];
}) {
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);
  const themePref = useThemeStore((s) => s.preference);
  const setThemePref = useThemeStore((s) => s.setPreference);
  const fontPref = useFontScaleStore((s) => s.preference);
  const setFontPref = useFontScaleStore((s) => s.setPreference);

  const m = messages(language);
  const a = m.appearanceSettings;

  /** Page layout: short control width (labels are short); avoid `w-full` stretching on wide rows. */
  const selectClass = cn(
    selectControlBaseClass,
    variant === 'page'
      ? 'w-full max-w-[min(100%,12rem)] shrink-0 sm:ml-auto sm:w-auto sm:max-w-[11rem]'
      : 'w-full',
  );

  const rowClass =
    variant === 'page'
      ? 'flex flex-col gap-2 border-b border-edge-subtle py-3.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:py-4'
      : 'flex flex-col gap-1.5';

  const show = (id: PreferenceSection) => sections.includes(id);

  return (
    <div className={cn(variant === 'sidebar' && 'flex flex-col gap-4')}>
      {show('language') ? (
        <div className={rowClass}>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-fg">{a.languageTitle}</div>
            <p className="mt-0.5 text-xs text-fg-muted">{a.languageDescription}</p>
          </div>
          <select
            className={selectClass}
            value={language}
            aria-label={a.languageTitle}
            onChange={(e) => setLanguage(e.target.value as StoredLanguage)}
          >
            <option value="en">{a.langOptionEn}</option>
            <option value="zh">{a.langOptionZh}</option>
          </select>
        </div>
      ) : null}

      {show('theme') ? (
        <div className={rowClass}>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-fg">{a.themeTitle}</div>
            <p className="mt-0.5 text-xs text-fg-muted">{a.themeDescription}</p>
          </div>
          <select
            className={selectClass}
            value={themePref}
            aria-label={a.themeTitle}
            onChange={(e) => setThemePref(e.target.value as ThemePreference)}
          >
            <option value="light">{a.themeOptionLight}</option>
            <option value="dark">{a.themeOptionDark}</option>
            <option value="system">{a.themeOptionSystem}</option>
          </select>
        </div>
      ) : null}

      {show('font') ? (
        <div className={rowClass}>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-fg">{a.fontScaleTitle}</div>
            <p className="mt-0.5 text-xs text-fg-muted">{a.fontScaleDescription}</p>
          </div>
          <select
            className={selectClass}
            value={fontPref}
            aria-label={a.fontScaleTitle}
            onChange={(e) => setFontPref(e.target.value as FontScalePreference)}
          >
            <option value="compact">{a.fontScaleCompact}</option>
            <option value="default">{a.fontScaleDefault}</option>
            <option value="large">{a.fontScaleLarge}</option>
          </select>
        </div>
      ) : null}
    </div>
  );
}
