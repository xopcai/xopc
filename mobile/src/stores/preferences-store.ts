/**
 * Preferences store — language + theme preference, persisted to MMKV.
 *
 * Mirrors web/src/stores/locale-store.ts + theme-store.ts combined,
 * adapted for React Native (no DOM, no View Transitions).
 */
import { Appearance } from 'react-native';
import { create } from 'zustand';

import { KEYS, storage } from '../storage/mmkv';

// ── Types ────────────────────────────────────────────────

export type Language = 'en' | 'zh';
export type ThemePreference = 'light' | 'dark' | 'system';

export type PreferencesState = {
  language: Language;
  themePreference: ThemePreference;
  /** The resolved effective theme (after applying "system" preference). */
  resolvedTheme: 'light' | 'dark';

  setLanguage: (lang: Language) => void;
  setThemePreference: (pref: ThemePreference) => void;
  /** Call once at app startup to hydrate from MMKV. */
  hydrate: () => void;
};

// ── Helpers ──────────────────────────────────────────────

function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'system') {
    return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
  }
  return pref;
}

function isValidLanguage(v: unknown): v is Language {
  return v === 'en' || v === 'zh';
}

function isValidThemePref(v: unknown): v is ThemePreference {
  return v === 'light' || v === 'dark' || v === 'system';
}

// ── Store ────────────────────────────────────────────────

export const usePreferencesStore = create<PreferencesState>((set, _get) => ({
  language: 'en',
  themePreference: 'system',
  resolvedTheme: resolveTheme('system'),

  setLanguage: (language) => {
    storage.set(KEYS.language, language);
    set({ language });
  },

  setThemePreference: (themePreference) => {
    const resolvedTheme = resolveTheme(themePreference);
    storage.set(KEYS.themePreference, themePreference);
    set({ themePreference, resolvedTheme });
  },

  hydrate: () => {
    const langRaw = storage.getString(KEYS.language);
    const themeRaw = storage.getString(KEYS.themePreference);
    const language = isValidLanguage(langRaw) ? langRaw : 'en';
    const themePreference = isValidThemePref(themeRaw) ? themeRaw : 'system';
    set({ language, themePreference, resolvedTheme: resolveTheme(themePreference) });
  },
}));

/**
 * Subscribe to system appearance changes — call once in root layout.
 * Updates resolvedTheme when system scheme changes & pref is "system".
 */
export function subscribeSystemAppearance(): () => void {
  const subscription = Appearance.addChangeListener(({ colorScheme }) => {
    const { themePreference } = usePreferencesStore.getState();
    if (themePreference === 'system') {
      usePreferencesStore.setState({
        resolvedTheme: colorScheme === 'dark' ? 'dark' : 'light',
      });
    }
  });
  return () => subscription.remove();
}
