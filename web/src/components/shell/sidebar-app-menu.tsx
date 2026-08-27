import {
  BookOpen,
  Check,
  ChevronRight,
  ExternalLink,
  Globe,
  HeartHandshake,
  Info,
  Palette,
  PawPrint,
  Settings,
  Type,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';
import { cn } from '@/lib/cn';
import { helpDocsHomeUrl } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';
import { type FontScalePreference, useFontScaleStore } from '@/stores/font-scale-store';
import { type ThemePreference, useThemeStore } from '@/stores/theme-store';
import type { DesktopPetState } from '@/types/electron';

type FlyoutId = 'lang' | 'theme' | 'font';

const rowClass = cn(
  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium leading-5 text-fg',
  'transition-colors duration-150 ease-out',
  'hover:bg-surface-hover',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
);

const flyoutSurfaceClass = cn(
  'rounded-xl border border-edge bg-surface-panel p-1 shadow-popover',
  'dark:border-edge',
);

function OptionRow({
  selected,
  label,
  onSelect,
}: {
  selected: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'flex w-full items-center justify-between gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium leading-5 text-fg',
        'transition-colors duration-150 ease-out hover:bg-surface-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
        selected && 'bg-accent-soft text-accent-fg hover:bg-accent-soft',
      )}
      onClick={onSelect}
    >
      <span className="min-w-0 truncate">{label}</span>
      <Check
        className={cn('size-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')}
        strokeWidth={2}
        aria-hidden
      />
    </button>
  );
}

export function SidebarAppMenu({
  onNavigate,
  onAboutClick,
}: {
  onNavigate?: () => void;
  /** Open About dialog; parent should close the app menu popover when handling this. */
  onAboutClick?: () => void;
}) {
  const [openFlyout, setOpenFlyout] = useState<FlyoutId | null>(null);
  const [petState, setPetState] = useState<DesktopPetState | null>(null);

  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);
  const themePref = useThemeStore((s) => s.preference);
  const setThemePref = useThemeStore((s) => s.setPreference);
  const fontPref = useFontScaleStore((s) => s.preference);
  const setFontPref = useFontScaleStore((s) => s.setPreference);

  const m = messages(language);
  const a = m.appearanceSettings;

  const currentLanguageLabel = language === 'zh' ? a.langOptionZh : a.langOptionEn;
  const currentThemeLabel =
    themePref === 'light'
      ? a.themeOptionLight
      : themePref === 'dark'
        ? a.themeOptionDark
        : a.themeOptionSystem;
  const currentFontLabel =
    fontPref === 'compact'
      ? a.fontScaleCompact
      : fontPref === 'large'
        ? a.fontScaleLarge
        : a.fontScaleDefault;
  const petApi = typeof window !== 'undefined' ? window.electronAPI?.pet : undefined;
  const showPetToggle = Boolean(petApi);
  const petToggleLabel = petState?.visible ? a.hideDesktopPet : a.showDesktopPet;

  useEffect(() => {
    if (!petApi) return;
    let cancelled = false;
    void petApi.getState().then((next) => {
      if (!cancelled) setPetState(next);
    });
    const cleanup = petApi.onStateChanged((next) => {
      if (!cancelled) setPetState(next);
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [petApi]);

  const togglePetVisibility = async () => {
    if (!petApi) return;
    if (petState?.visible) {
      await petApi.hide();
    } else {
      await petApi.show();
    }
    setPetState(await petApi.getState());
  };

  /** Modest gap between the left rail and the flyout. */
  const flyoutGapClass = 'ml-2 sm:ml-2.5';

  const flyoutShell = (id: FlyoutId) =>
    cn(
      'absolute left-full top-0 z-[60] min-w-[8.75rem] max-w-[min(calc(100vw-2rem),12rem)]',
      flyoutGapClass,
      openFlyout === id ? 'block' : 'hidden',
    );

  /** Spans the gap + slight overlap into the panel for stable hover. */
  const bridgeClass = (id: FlyoutId) =>
    cn(
      'absolute left-full top-0 z-[55] h-full w-8 sm:w-9',
      openFlyout === id ? 'pointer-events-auto' : 'pointer-events-none',
    );

  return (
    <div
      className="w-[min(calc(100vw-2rem),13rem)] shrink-0 py-0.5"
      onMouseLeave={() => setOpenFlyout(null)}
    >
      <div className="relative" onMouseEnter={() => setOpenFlyout('lang')}>
        <button
          type="button"
          className={cn(rowClass, openFlyout === 'lang' && 'bg-surface-hover')}
          aria-haspopup="menu"
          aria-expanded={openFlyout === 'lang'}
        >
          <Globe className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1 text-left">{a.languageTitle}</span>
          <span className="max-w-20 truncate text-xs font-medium text-fg-muted">{currentLanguageLabel}</span>
          <ChevronRight className="size-4 shrink-0 text-fg-subtle" strokeWidth={2} aria-hidden />
        </button>
        <div className={bridgeClass('lang')} aria-hidden />
        <div className={flyoutShell('lang')} role="menu" aria-label={a.languageTitle}>
          <div className={flyoutSurfaceClass}>
            <OptionRow
              selected={language === 'en'}
              label={a.langOptionEn}
              onSelect={() => setLanguage('en' satisfies StoredLanguage)}
            />
            <OptionRow
              selected={language === 'zh'}
              label={a.langOptionZh}
              onSelect={() => setLanguage('zh' satisfies StoredLanguage)}
            />
          </div>
        </div>
      </div>

      <div className="relative" onMouseEnter={() => setOpenFlyout('theme')}>
        <button
          type="button"
          className={cn(rowClass, openFlyout === 'theme' && 'bg-surface-hover')}
          aria-haspopup="menu"
          aria-expanded={openFlyout === 'theme'}
        >
          <Palette className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1 text-left">{a.themeTitle}</span>
          <span className="max-w-20 truncate text-xs font-medium text-fg-muted">{currentThemeLabel}</span>
          <ChevronRight className="size-4 shrink-0 text-fg-subtle" strokeWidth={2} aria-hidden />
        </button>
        <div className={bridgeClass('theme')} aria-hidden />
        <div className={flyoutShell('theme')} role="menu" aria-label={a.themeTitle}>
          <div className={flyoutSurfaceClass}>
            <OptionRow
              selected={themePref === 'light'}
              label={a.themeOptionLight}
              onSelect={() => setThemePref('light' satisfies ThemePreference)}
            />
            <OptionRow
              selected={themePref === 'dark'}
              label={a.themeOptionDark}
              onSelect={() => setThemePref('dark' satisfies ThemePreference)}
            />
            <OptionRow
              selected={themePref === 'system'}
              label={a.themeOptionSystem}
              onSelect={() => setThemePref('system' satisfies ThemePreference)}
            />
          </div>
        </div>
      </div>

      <div className="relative" onMouseEnter={() => setOpenFlyout('font')}>
        <button
          type="button"
          className={cn(rowClass, openFlyout === 'font' && 'bg-surface-hover')}
          aria-haspopup="menu"
          aria-expanded={openFlyout === 'font'}
        >
          <Type className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1 text-left">{a.fontScaleTitle}</span>
          <span className="max-w-20 truncate text-xs font-medium text-fg-muted">{currentFontLabel}</span>
          <ChevronRight className="size-4 shrink-0 text-fg-subtle" strokeWidth={2} aria-hidden />
        </button>
        <div className={bridgeClass('font')} aria-hidden />
        <div className={flyoutShell('font')} role="menu" aria-label={a.fontScaleTitle}>
          <div className={flyoutSurfaceClass}>
            <OptionRow
              selected={fontPref === 'compact'}
              label={a.fontScaleCompact}
              onSelect={() => setFontPref('compact' satisfies FontScalePreference)}
            />
            <OptionRow
              selected={fontPref === 'default'}
              label={a.fontScaleDefault}
              onSelect={() => setFontPref('default' satisfies FontScalePreference)}
            />
            <OptionRow
              selected={fontPref === 'large'}
              label={a.fontScaleLarge}
              onSelect={() => setFontPref('large' satisfies FontScalePreference)}
            />
          </div>
        </div>
      </div>

      {showPetToggle ? (
        <button
          type="button"
          className={rowClass}
          onClick={() => void togglePetVisibility()}
          onMouseEnter={() => setOpenFlyout(null)}
          onFocus={() => setOpenFlyout(null)}
        >
          <PawPrint className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1 text-left">{petToggleLabel}</span>
        </button>
      ) : null}

      <Link
        to="/you"
        className={rowClass}
        onMouseEnter={() => setOpenFlyout(null)}
        onFocus={() => setOpenFlyout(null)}
        onClick={() => onNavigate?.()}
      >
        <HeartHandshake className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1">{m.nav.profile}</span>
      </Link>

      <div className="my-2 h-px bg-edge-subtle" role="separator" />

      <button
        type="button"
        className={rowClass}
        onClick={() => onAboutClick?.()}
        onMouseEnter={() => setOpenFlyout(null)}
        onFocus={() => setOpenFlyout(null)}
      >
        <Info className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 text-left">{a.aboutApp}</span>
      </button>

      <a
        href={helpDocsHomeUrl(language)}
        target="_blank"
        rel="noopener noreferrer"
        className={rowClass}
        onMouseEnter={() => setOpenFlyout(null)}
        onFocus={() => setOpenFlyout(null)}
      >
        <BookOpen className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 text-left">{m.sidebar.helpDocs}</span>
        <ExternalLink className="size-3.5 shrink-0 text-fg-subtle" strokeWidth={2} aria-hidden />
      </a>

      <Link
        to="/settings/overview"
        className={cn(
          rowClass,
          'text-accent-fg hover:bg-accent-soft hover:text-accent-fg',
        )}
        onMouseEnter={() => setOpenFlyout(null)}
        onFocus={() => setOpenFlyout(null)}
        onClick={() => onNavigate?.()}
      >
        <Settings className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1">{a.openFullPreferences}</span>
      </Link>
    </div>
  );
}
