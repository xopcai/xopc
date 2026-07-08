import type { GlobalHit } from '@/features/search/global-command-palette/types';
import type { StoredLanguage } from '@/lib/storage';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useThemeStore, type ThemePreference } from '@/stores/theme-store';

function setTheme(p: ThemePreference) {
  useThemeStore.getState().setPreference(p);
}

function setLanguage(next: StoredLanguage) {
  useLocaleStore.getState().setLanguage(next);
}

export function buildQuickSettingHits(
  language: StoredLanguage,
  opts: {
    closePalette: () => void;
    openModelPalette: () => void;
    openAgentPalette: () => void;
  },
): Array<Omit<GlobalHit, 'rank'>> {
  const m = messages(language);
  const q = m.commandPalette.quickSettings;
  const groupLabel = m.commandPalette.groups.quickSettings;

  return [
    {
      kind: 'setting',
      id: 'setting:model',
      title: q.switchModel,
      subtitle: q.switchModelSubtitle,
      groupLabel,
      keywords: ['model', 'default model', '默认模型', 'gpt', 'claude', 'gemini', 'llm', '模型'],
      run: () => opts.openModelPalette(),
    },
    {
      kind: 'setting',
      id: 'setting:agent',
      title: q.switchAgent,
      subtitle: q.switchAgentSubtitle,
      groupLabel,
      keywords: ['agent', 'persona', 'bot'],
      run: () => opts.openAgentPalette(),
    },
    {
      kind: 'setting',
      id: 'setting:theme:light',
      title: q.themeLight,
      subtitle: q.appearanceSubtitle,
      groupLabel,
      keywords: ['theme', 'light', 'appearance'],
      run: () => {
        setTheme('light');
        opts.closePalette();
      },
    },
    {
      kind: 'setting',
      id: 'setting:theme:dark',
      title: q.themeDark,
      subtitle: q.appearanceSubtitle,
      groupLabel,
      keywords: ['theme', 'dark', 'night'],
      run: () => {
        setTheme('dark');
        opts.closePalette();
      },
    },
    {
      kind: 'setting',
      id: 'setting:theme:system',
      title: q.themeSystem,
      subtitle: q.appearanceSubtitle,
      groupLabel,
      keywords: ['theme', 'system', 'auto'],
      run: () => {
        setTheme('system');
        opts.closePalette();
      },
    },
    {
      kind: 'setting',
      id: 'setting:lang:en',
      title: q.languageEn,
      subtitle: q.languageSubtitle,
      groupLabel,
      keywords: ['english', 'language', 'locale'],
      run: () => {
        setLanguage('en');
        opts.closePalette();
      },
    },
    {
      kind: 'setting',
      id: 'setting:lang:zh',
      title: q.languageZh,
      subtitle: q.languageSubtitle,
      groupLabel,
      keywords: ['chinese', '中文', 'language'],
      run: () => {
        setLanguage('zh');
        opts.closePalette();
      },
    },
  ];
}
