import type { GlobalHit } from '@/features/search/global-command-palette/types';
import type { StoredLanguage } from '@/lib/storage';
import { useLocaleStore } from '@/stores/locale-store';
import { useThemeStore, type ThemePreference } from '@/stores/theme-store';

function setTheme(p: ThemePreference) {
  useThemeStore.getState().setPreference(p);
}

function setLanguage(next: StoredLanguage) {
  useLocaleStore.getState().setLanguage(next);
}

export function buildQuickSettingHits(
  language: 'en' | 'zh',
  opts: {
    closePalette: () => void;
    openModelPalette: () => void;
    openAgentPalette: () => void;
  },
): Array<Omit<GlobalHit, 'rank'>> {
  const isZh = language === 'zh';

  return [
    {
      kind: 'setting',
      id: 'setting:model',
      title: isZh ? '切换模型' : 'Switch model',
      subtitle: isZh ? '更改默认 AI 模型' : 'Change the default AI model',
      groupLabel: 'Quick Settings',
      keywords: ['model', 'gpt', 'claude', 'gemini', 'llm'],
      run: () => opts.openModelPalette(),
    },
    {
      kind: 'setting',
      id: 'setting:agent',
      title: isZh ? '切换智能体' : 'Switch agent',
      subtitle: isZh ? '更改新对话使用的智能体' : 'Change the agent for new chats',
      groupLabel: 'Quick Settings',
      keywords: ['agent', 'persona', 'bot'],
      run: () => opts.openAgentPalette(),
    },
    {
      kind: 'setting',
      id: 'setting:theme:light',
      title: isZh ? '切换到浅色主题' : 'Switch to light theme',
      subtitle: isZh ? '外观' : 'Appearance',
      groupLabel: 'Quick Settings',
      keywords: ['theme', 'light', 'appearance'],
      run: () => {
        setTheme('light');
        opts.closePalette();
      },
    },
    {
      kind: 'setting',
      id: 'setting:theme:dark',
      title: isZh ? '切换到深色主题' : 'Switch to dark theme',
      subtitle: isZh ? '外观' : 'Appearance',
      groupLabel: 'Quick Settings',
      keywords: ['theme', 'dark', 'night'],
      run: () => {
        setTheme('dark');
        opts.closePalette();
      },
    },
    {
      kind: 'setting',
      id: 'setting:theme:system',
      title: isZh ? '使用系统主题' : 'Use system theme',
      subtitle: isZh ? '外观' : 'Appearance',
      groupLabel: 'Quick Settings',
      keywords: ['theme', 'system', 'auto'],
      run: () => {
        setTheme('system');
        opts.closePalette();
      },
    },
    {
      kind: 'setting',
      id: 'setting:lang:en',
      title: 'Switch to English',
      subtitle: isZh ? '语言' : 'Language',
      groupLabel: 'Quick Settings',
      keywords: ['english', 'language', 'locale'],
      run: () => {
        setLanguage('en');
        opts.closePalette();
      },
    },
    {
      kind: 'setting',
      id: 'setting:lang:zh',
      title: '切换到中文',
      subtitle: isZh ? '语言' : 'Language',
      groupLabel: 'Quick Settings',
      keywords: ['chinese', '中文', 'language'],
      run: () => {
        setLanguage('zh');
        opts.closePalette();
      },
    },
  ];
}
