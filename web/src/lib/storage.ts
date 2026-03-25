/**
 * LocalStorage keys for gateway token and UI locale.
 */

const TOKEN_KEY = 'xopcbot.token';
const LANGUAGE_KEY = 'xopcbot.language';

export type StoredLanguage = 'en' | 'zh';

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch (err) {
    console.error('Failed to save token:', err);
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (err) {
    console.error('Failed to clear token:', err);
  }
}

export function getLanguage(): StoredLanguage {
  try {
    const lang = localStorage.getItem(LANGUAGE_KEY) as StoredLanguage;
    return lang === 'en' || lang === 'zh' ? lang : 'en';
  } catch {
    return 'en';
  }
}

export function setLanguage(lang: StoredLanguage): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, lang);
  } catch (err) {
    console.error('Failed to save language:', err);
  }
}
