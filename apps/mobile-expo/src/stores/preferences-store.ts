/**
 * Preferences store — language + theme preference, persisted to MMKV.
 *
 * Mirrors web/src/stores/locale-store.ts + theme-store.ts combined,
 * adapted for React Native (no DOM, no View Transitions).
 */
import { Appearance, Platform } from 'react-native';
import { create } from 'zustand';

import { KEYS, storage } from '../storage/mmkv';

// ── Types ────────────────────────────────────────────────

export type Language = 'en' | 'zh';
export type ThemePreference = 'light' | 'dark' | 'system';

export type PreferencesState = {
  hydrated: boolean;
  language: Language;
  themePreference: ThemePreference;
  /** The resolved effective theme (after applying "system" preference). */
  resolvedTheme: 'light' | 'dark';
  /** App override for default agent; null = follow gateway defaultId. */
  defaultAgentId: string | null;
  /** App override for chat LLM model ref; null = follow gateway default model. */
  selectedModelRef: string | null;
  /** Foreground clipboard intake prompt. */
  clipboardIntakeEnabled: boolean;

  setLanguage: (lang: Language) => void;
  setThemePreference: (pref: ThemePreference) => void;
  setClipboardIntakeEnabled: (enabled: boolean) => void;
  setDefaultAgentId: (agentId: string | null) => void;
  setSelectedModelRef: (modelRef: string | null) => void;
  /** Call once at app startup to hydrate from MMKV. */
  hydrate: () => void;
};

// ── Helpers ──────────────────────────────────────────────

/** Push preference to RN so `useColorScheme()` matches the user's choice (native only). */
function syncAppearance(pref: ThemePreference): void {
  if (Platform.OS === 'web') return;
  Appearance.setColorScheme(pref === 'system' ? 'unspecified' : pref);
}

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
  hydrated: false,
  language: 'en',
  themePreference: 'system',
  resolvedTheme: resolveTheme('system'),
  defaultAgentId: null,
  selectedModelRef: null,
  clipboardIntakeEnabled: true,

  setLanguage: (language) => {
    storage.set(KEYS.language, language);
    set({ language });
  },

  setThemePreference: (themePreference) => {
    syncAppearance(themePreference);
    const resolvedTheme = resolveTheme(themePreference);
    storage.set(KEYS.themePreference, themePreference);
    set({ themePreference, resolvedTheme });
  },

  setClipboardIntakeEnabled: (clipboardIntakeEnabled) => {
    storage.set(KEYS.clipboardIntakeEnabled, clipboardIntakeEnabled);
    set({ clipboardIntakeEnabled });
  },

  setDefaultAgentId: (defaultAgentId) => {
    const normalized = defaultAgentId?.trim().toLowerCase() || null;
    if (normalized) storage.set(KEYS.defaultAgentId, normalized);
    else storage.delete(KEYS.defaultAgentId);
    set({ defaultAgentId: normalized });
  },

  setSelectedModelRef: (selectedModelRef) => {
    const normalized = selectedModelRef?.trim() || null;
    if (normalized) storage.set(KEYS.selectedModelRef, normalized);
    else storage.delete(KEYS.selectedModelRef);
    set({ selectedModelRef: normalized });
  },

  hydrate: () => {
    const langRaw = storage.getString(KEYS.language);
    const themeRaw = storage.getString(KEYS.themePreference);
    const clipboardRaw = storage.getString(KEYS.clipboardIntakeEnabled);
    const agentRaw = storage.getString(KEYS.defaultAgentId);
    const modelRaw = storage.getString(KEYS.selectedModelRef);
    const language = isValidLanguage(langRaw) ? langRaw : 'en';
    const themePreference = isValidThemePref(themeRaw) ? themeRaw : 'system';
    const clipboardIntakeEnabled = clipboardRaw === undefined ? true : clipboardRaw !== 'false';
    const defaultAgentId = agentRaw?.trim().toLowerCase() || null;
    const selectedModelRef = modelRaw?.trim() || null;
    syncAppearance(themePreference);
    set({
      hydrated: true,
      language,
      themePreference,
      resolvedTheme: resolveTheme(themePreference),
      clipboardIntakeEnabled,
      defaultAgentId,
      selectedModelRef,
    });
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
