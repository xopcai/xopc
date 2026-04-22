/**
 * Default UI language from OS / browser locale.
 * Rule: English (`en`, `en-*`) → `en`; any other primary locale → `zh`.
 */

export type UiLanguage = 'en' | 'zh';

/** Map BCP 47 / POSIX-ish tags (e.g. en-US, zh_CN). */
export function uiLanguageFromLocaleTag(locale: string | undefined | null): UiLanguage {
  const t = (locale ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (!t) return 'en';
  if (t === 'en' || t.startsWith('en-')) return 'en';
  return 'zh';
}

/** Browser or Electron renderer: use primary `navigator.language`. */
export function inferDefaultLanguageFromEnvironment(): UiLanguage {
  if (typeof navigator === 'undefined') {
    return 'en';
  }
  const tag = (navigator.language || navigator.languages?.[0] || '').trim();
  if (!tag) return 'en';
  return uiLanguageFromLocaleTag(tag);
}

export function htmlLangAttribute(lang: UiLanguage): string {
  return lang === 'zh' ? 'zh-CN' : 'en';
}
