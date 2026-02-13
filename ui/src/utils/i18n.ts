import enTranslations from '../i18n/en.json';
import zhTranslations from '../i18n/zh.json';

export type Language = 'en' | 'zh';

// Built-in translations (bundled for production compatibility)
const builtInTranslations: Record<Language, Record<string, unknown>> = {
  en: enTranslations as Record<string, unknown>,
  zh: zhTranslations as Record<string, unknown>,
};

// Translation cache (for runtime-loaded translations)
const translationCache: Map<Language, Record<string, unknown>> = new Map();

// Initialize cache with built-in translations
translationCache.set('en', builtInTranslations.en);
translationCache.set('zh', builtInTranslations.zh);

let currentLanguage: Language = 'en';

// Simple path-based translation getter
export function t(path: string, params?: Record<string, string | number>): string {
  const translations = translationCache.get(currentLanguage);
  if (!translations) return path;
  
  const keys = path.split('.');
  let value: unknown = translations;
  
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = (value as Record<string, unknown>)[key];
    } else {
      // Fallback to English
      const enTranslations = translationCache.get('en');
      if (enTranslations && currentLanguage !== 'en') {
        let enValue: unknown = enTranslations;
        for (const k of keys) {
          if (enValue && typeof enValue === 'object' && k in enValue) {
            enValue = (enValue as Record<string, unknown>)[k];
          } else {
            return path;
          }
        }
        value = enValue;
      } else {
        return path;
      }
    }
  }
  
  if (typeof value !== 'string') return path;
  
  // Replace params
  if (params) {
    return value.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const paramValue = params[key];
      return paramValue !== undefined ? String(paramValue) : `{{${key}}}`;
    });
  }
  
  return value;
}

// Load translations for a language (runtime loading, optional)
export async function loadLanguage(lang: Language): Promise<void> {
  if (translationCache.has(lang)) {
    currentLanguage = lang;
    return;
  }
  
  try {
    const response = await fetch(`/src/i18n/${lang}.json`);
    if (!response.ok) {
      throw new Error(`Failed to load ${lang} translations`);
    }
    const translations = await response.json();
    translationCache.set(lang, translations);
    currentLanguage = lang;
    
    // Dispatch language change event
    window.dispatchEvent(new CustomEvent('languagechange', { detail: { language: lang } }));
  } catch (error) {
    console.error(`Failed to load ${lang} translations:`, error);
    // Fallback to English if available
    if (lang !== 'en' && translationCache.has('en')) {
      currentLanguage = 'en';
    }
  }
}

// Set language
export function setLanguage(lang: Language): void {
  if (translationCache.has(lang)) {
    currentLanguage = lang;
    window.dispatchEvent(new CustomEvent('languagechange', { detail: { language: lang } }));
  } else {
    // Try to load
    loadLanguage(lang);
  }
}

// Get current language
export function getCurrentLanguage(): Language {
  return currentLanguage;
}

// Initialize i18n (sync - uses built-in translations)
export function initI18n(defaultLang: Language = 'en'): void {
  currentLanguage = defaultLang;
}

// Legacy compatibility - old translation keys
export const legacyKeys: Record<string, string> = {
  'Type a message...': 'chat.typeMessage',
  'Attach file': 'chat.attachFile',
  'Send message': 'chat.sendMessage',
  'Abort': 'chat.abort',
  'No session available': 'errors.noSession',
  'No agent set': 'errors.noAgent',
  'Configuration': 'config.title',
  'Cancel': 'settings.cancel',
  'Save': 'settings.save',
  'No result': 'config.noResult',
  'Artifacts': 'config.artifacts',
  'Show artifacts': 'config.showArtifacts',
};

// Legacy i18n function for backward compatibility
export function i18n(key: string): string {
  // First check if it's a legacy key
  const newKey = legacyKeys[key];
  if (newKey) {
    return t(newKey);
  }
  // If not a legacy key, try to use as path
  return t(key);
}

// Export for direct access
export { translationCache as translations };
