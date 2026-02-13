export type Language = 'en' | 'zh';

// Translation cache
const translationCache: Map<Language, Record<string, unknown>> = new Map();

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

// Load translations for a language
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

// Set language (synchronous, assumes translations are already loaded)
export function setLanguage(lang: Language): void {
  if (translationCache.has(lang)) {
    currentLanguage = lang;
    window.dispatchEvent(new CustomEvent('languagechange', { detail: { language: lang } }));
  } else {
    // Load and then set
    loadLanguage(lang);
  }
}

// Get current language
export function getCurrentLanguage(): Language {
  return currentLanguage;
}

// Preload default language
export async function initI18n(defaultLang: Language = 'en'): Promise<void> {
  await loadLanguage(defaultLang);
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
  const newKey = legacyKeys[key];
  if (newKey) {
    return t(newKey);
  }
  return key;
}

// Export translations for direct access (mainly for types)
export { translationCache as translations };
