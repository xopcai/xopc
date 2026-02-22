/**
 * LocalStorage utilities for xopcbot UI settings.
 * Uses individual keys instead of object storage.
 */

// Individual storage keys
const TOKEN_KEY = 'xopcbot.token';
const THEME_KEY = 'xopcbot.theme';
const LANGUAGE_KEY = 'xopcbot.language';

export type Theme = 'light' | 'dark' | 'system';
export type Language = 'en' | 'zh';

/**
 * Get the gateway token.
 * No gatewayUrl needed - always uses current origin.
 */
export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * Set the gateway token.
 */
export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch (err) {
    console.error('Failed to save token:', err);
  }
}

/**
 * Get the theme.
 */
export function getTheme(): Theme {
  try {
    const theme = localStorage.getItem(THEME_KEY) as Theme;
    return theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Set the theme.
 */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (err) {
    console.error('Failed to save theme:', err);
  }
}

/**
 * Get the language.
 */
export function getLanguage(): Language {
  try {
    const lang = localStorage.getItem(LANGUAGE_KEY) as Language;
    return lang === 'en' || lang === 'zh' ? lang : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Set the language.
 */
export function setLanguage(lang: Language): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, lang);
  } catch (err) {
    console.error('Failed to save language:', err);
  }
}

/**
 * Clear all settings.
 */
export function clearSettings(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(THEME_KEY);
    localStorage.removeItem(LANGUAGE_KEY);
  } catch (err) {
    console.error('Failed to clear settings:', err);
  }
}

// Legacy compatibility - for old code that uses loadSettings/saveSettings
export interface UiSettings {
  gatewayUrl: string;
  token: string;
  theme: Theme;
  language: Language;
}

/**
 * @deprecated Use individual getters/setters instead
 */
export function loadSettings(): UiSettings {
  return {
    gatewayUrl: '', // No longer used - always uses current origin
    token: getToken(),
    theme: getTheme(),
    language: getLanguage(),
  };
}

/**
 * @deprecated Use individual setters instead
 */
export function saveSettings(settings: Partial<UiSettings>): void {
  if (settings.token !== undefined) setToken(settings.token);
  if (settings.theme !== undefined) setTheme(settings.theme);
  if (settings.language !== undefined) setLanguage(settings.language);
}

// Legacy aliases
export const getGatewayToken = getToken;
export const setGatewayToken = setToken;
