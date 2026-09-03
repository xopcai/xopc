/**
 * Preferences store — language + theme preference, persisted to MMKV.
 *
 * Mirrors web/src/stores/locale-store.ts + theme-store.ts combined,
 * adapted for React Native (no DOM, no View Transitions).
 */
import { Appearance } from 'react-native';
import { create } from 'zustand';
import {
  createDefaultNewSessionPreferences,
  parseNewSessionPreferences,
  withAgentModelPreference,
  withLastChatScope,
  withSelectedAgent,
  type AgentModelPreference,
  type NewSessionPreferences,
} from '@xopcai/gateway-contract';

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
  newSessionPreferencesByGateway: Record<string, NewSessionPreferences>;
  /** Foreground clipboard intake prompt. */
  clipboardIntakeEnabled: boolean;
  /** Local intent to receive gateway push notifications. System permission is tracked separately. */
  notificationsEnabled: boolean;
  /** Automatically read new assistant replies aloud. */
  autoReadAloudEnabled: boolean;

  setLanguage: (lang: Language) => void;
  setThemePreference: (pref: ThemePreference) => void;
  setClipboardIntakeEnabled: (enabled: boolean) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setAutoReadAloudEnabled: (enabled: boolean) => void;
  setDefaultAgentId: (agentId: string | null) => void;
  rememberSelectedAgent: (gatewayId: string, agentId: string | null) => void;
  rememberAgentModel: (
    gatewayId: string,
    agentId: string,
    preference: AgentModelPreference | null,
  ) => void;
  rememberLastChatScope: (gatewayId: string, projectId: string | null) => void;
  /** Call once at app startup to hydrate from MMKV. */
  hydrate: () => void;
};

// ── Helpers ──────────────────────────────────────────────

/** Push preference to React Native so `useColorScheme()` matches the user's choice. */
function syncAppearance(pref: ThemePreference): void {
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

function readPreferencesByGateway(raw: string | undefined): Record<string, NewSessionPreferences> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([gatewayId, value]) => [
        gatewayId,
        parseNewSessionPreferences(value),
      ]),
    );
  } catch {
    return {};
  }
}

function writePreferencesByGateway(
  preferencesByGateway: Record<string, NewSessionPreferences>,
): void {
  storage.set(KEYS.newSessionPreferencesByGateway, JSON.stringify(preferencesByGateway));
}

// ── Store ────────────────────────────────────────────────

export const usePreferencesStore = create<PreferencesState>((set, _get) => ({
  hydrated: false,
  language: 'en',
  themePreference: 'system',
  resolvedTheme: resolveTheme('system'),
  defaultAgentId: null,
  newSessionPreferencesByGateway: {},
  clipboardIntakeEnabled: false,
  notificationsEnabled: false,
  autoReadAloudEnabled: false,

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

  setNotificationsEnabled: (notificationsEnabled) => {
    storage.set(KEYS.notificationsEnabled, notificationsEnabled);
    set({ notificationsEnabled });
  },

  setAutoReadAloudEnabled: (autoReadAloudEnabled) => {
    storage.set(KEYS.autoReadAloudEnabled, autoReadAloudEnabled);
    set({ autoReadAloudEnabled });
  },

  setDefaultAgentId: (defaultAgentId) => {
    const normalized = defaultAgentId?.trim().toLowerCase() || null;
    if (normalized) storage.set(KEYS.defaultAgentId, normalized);
    else storage.delete(KEYS.defaultAgentId);
    set({ defaultAgentId: normalized });
  },

  rememberSelectedAgent: (gatewayId, agentId) => set((state) => {
    const current = state.newSessionPreferencesByGateway[gatewayId]
      ?? createDefaultNewSessionPreferences();
    const newSessionPreferencesByGateway = {
      ...state.newSessionPreferencesByGateway,
      [gatewayId]: withSelectedAgent(current, agentId),
    };
    writePreferencesByGateway(newSessionPreferencesByGateway);
    return { newSessionPreferencesByGateway };
  }),

  rememberAgentModel: (gatewayId, agentId, preference) => set((state) => {
    const current = state.newSessionPreferencesByGateway[gatewayId]
      ?? createDefaultNewSessionPreferences();
    const newSessionPreferencesByGateway = {
      ...state.newSessionPreferencesByGateway,
      [gatewayId]: withAgentModelPreference(current, agentId, preference),
    };
    writePreferencesByGateway(newSessionPreferencesByGateway);
    return { newSessionPreferencesByGateway };
  }),

  rememberLastChatScope: (gatewayId, projectId) => set((state) => {
    const current = state.newSessionPreferencesByGateway[gatewayId]
      ?? createDefaultNewSessionPreferences();
    const newSessionPreferencesByGateway = {
      ...state.newSessionPreferencesByGateway,
      [gatewayId]: withLastChatScope(current, projectId),
    };
    writePreferencesByGateway(newSessionPreferencesByGateway);
    return { newSessionPreferencesByGateway };
  }),

  hydrate: () => {
    const langRaw = storage.getString(KEYS.language);
    const themeRaw = storage.getString(KEYS.themePreference);
    const clipboardRaw = storage.getString(KEYS.clipboardIntakeEnabled);
    const agentRaw = storage.getString(KEYS.defaultAgentId);
    const preferencesByGatewayRaw = storage.getString(KEYS.newSessionPreferencesByGateway);
    const notificationsRaw = storage.getString(KEYS.notificationsEnabled);
    const autoReadAloudRaw = storage.getString(KEYS.autoReadAloudEnabled);
    const language = isValidLanguage(langRaw) ? langRaw : 'en';
    const themePreference = isValidThemePref(themeRaw) ? themeRaw : 'system';
    const clipboardIntakeEnabled = clipboardRaw === 'true';
    const defaultAgentId = agentRaw?.trim().toLowerCase() || null;
    const newSessionPreferencesByGateway = readPreferencesByGateway(preferencesByGatewayRaw);
    const notificationsEnabled = notificationsRaw === 'true';
    const autoReadAloudEnabled = autoReadAloudRaw === 'true';
    syncAppearance(themePreference);
    set({
      hydrated: true,
      language,
      themePreference,
      resolvedTheme: resolveTheme(themePreference),
      clipboardIntakeEnabled,
      notificationsEnabled,
      autoReadAloudEnabled,
      defaultAgentId,
      newSessionPreferencesByGateway,
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
