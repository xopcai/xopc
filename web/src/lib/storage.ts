/**
 * LocalStorage keys for gateway token and UI locale.
 */

import { inferDefaultLanguageFromEnvironment } from './locale-default';

const LANGUAGE_KEY = 'xopc.language';

export type StoredLanguage = 'en' | 'zh';

export function getLanguage(): StoredLanguage {
  const stored = getStoredLanguage();
  if (stored) {
    return stored;
  }
  return inferDefaultLanguageFromEnvironment();
}

export function getStoredLanguage(): StoredLanguage | null {
  try {
    const lang = localStorage.getItem(LANGUAGE_KEY) as StoredLanguage;
    if (lang === 'en' || lang === 'zh') {
      return lang;
    }
    return null;
  } catch {
    return null;
  }
}

export function setLanguage(lang: StoredLanguage): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, lang);
  } catch (err) {
    console.error('Failed to save language:', err);
  }
}
